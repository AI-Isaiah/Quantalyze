# Phase 10: Scenario Builder and What-If — Research

**Researched:** 2026-04-25
**Domain:** Client-side portfolio scenario composition, draft-vs-live state, Bridge outcome routing, schema XOR relaxation
**Confidence:** HIGH — research grounded entirely in codebase inspection and verified existing patterns

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Unified state via scenario-adapter.ts casting holdings to StrategyForBuilder — id = "holding:{venue}:{symbol}:{holding_type}", zero engine changes.
- **D-02:** Toggle-off → proportional renormalization of remaining active weights.
- **D-03:** Bridge "Add to scenario" = flagged-holding's current weight; Browse-add = 1/(active+1).
- **D-04:** holdingReturnsByScopeRef: Record<scope_ref, DailyPoint[]> added to getMyAllocationDashboard payload, reconstructed from allocator_equity_snapshots.breakdown.
- **D-05:** Two discovery surfaces — Bridge inline "Add to scenario" + StrategyBrowseDrawer.
- **D-06:** StrategyBrowseDrawer shape — 620px right slide-over, matches BridgeDrawer pattern.
- **D-07:** /scenarios sandbox kept independent; cross-link only.
- **D-08:** Mandate-fit pill per row — ≥0.7 green, 0.4≤x<0.7 yellow, <0.4 red — informational only.
- **D-09:** Commit = ScenarioCommitDrawer (720px right slide-over) with grouped diff sections + per-row inline forms + single "Submit all" + one transaction via POST /api/allocator/scenario/commit.
- **D-10:** Voluntary toggle-off → kind='voluntary_remove' match_decision row at commit time; Path A preferred (kind enum column + per-kind CHECK replaces XOR).
- **D-11:** Voluntary add → kind='voluntary_add' match_decision row; hybrid Bridge+holding = 'bridge_recommended'.
- **D-12:** Sticky footer — 56px, full-width within tab, diff count + delta summary + Reset + Commit.
- **D-13:** KpiStrip mode="scenario" variant with delta badges; Phase 07 warmup paths preserved.
- **D-14:** EquityChart + DrawdownChart: second scenarioSeries prop; Live baseline = muted, scenario = accent; 3-state toggle "Live · Scenario · Both".
- **D-15:** Commit drawer grouped sections: Holdings removed / Strategies added / Weight changes.
- **D-16:** Direction-aware delta color tokens from DESIGN.md; noise floor |Δ|<0.01 abs or |Δ|<1% rel = neutral gray.
- **Feature flag:** Lives entirely under allocations.ui_v2 (inherited from Phase 09.1 D-17) — no new flag.
- **No new npm deps:** Zero package additions (Phase 09 + Phase 09.1 precedent).
- **Migration 080:** Relax Phase 09 XOR constraint + add kind enum column. Self-verifying DO block. Atomic with ADR-0023 sync.
- **ENGINE_VERSION stays v2.1.0:** No engine bump — scenario projection is pure client-side.
- **LAYOUT_VERSION stays 4:** Scenario tab is full-width body, not a widget grid.

### Claude's Discretion

- **D-17:** Weight-change diff treatment — ship as voluntary_modify (option a) per UI-SPEC default.
- **Browse-drawer search algorithm** — alias-substring (existing pattern in /strategies browse).
- **Browse-drawer initial load** — full list (verified strategy count is tens, not thousands).
- **Holdings warm-up gate** — <30 days of breakdown data → exclude from computeScenario; mirror Phase 07 D-03 warmup gate.
- **Mixed portfolios** — legacy portfolio_strategies rows + holdings both show with same toggle/weight semantics.
- **localStorage shape + invalidation** — key: allocations.scenario_v0_15; fingerprint-mismatch → warning banner (default: keep draft).
- **Reset confirmation modal copy** — fixed in UI-SPEC.
- **Commit-success behavior** — drawer collapses to green confirmation, draft resets to new live state.
- **Sticky footer z-index collision** — verify no collision with HoldingNoteRow / OutcomesWidget sub-row.
- **/compare deep-link** — ship for flagged holdings where top candidate exists.
- **PostHog events** — scenario_opened, scenario_holding_toggled, scenario_strategy_added, scenario_committed, scenario_reset.
- **API route shape** — POST /api/allocator/scenario/commit, one-shot transaction.
- **Empty-portfolio path** — EmptyState with dual CTA (Connect Exchange + Browse strategies).

### Deferred Ideas (OUT OF SCOPE)

- DB persistence of scenario drafts (SCENARIO-08 explicit lock)
- Multi-scenario / named scenarios
- Scenario fit-score via score_candidates()
- Stress testing / regime scenarios
- Cash bucket / non-zero idle weight
- Component unification with /scenarios sandbox
- Mobile responsive polish
- Pure weight-change diff outcome semantics (if planner picks option c over a)
- Scenario PostHog instrumentation hookup (Phase 11)
- PDF / report export of a scenario
- Wallet OAuth / on-chain holdings

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCENARIO-01 | Scenario tab initializes from allocator's current portfolio (all holdings enabled), distinct draft | scenario-state.ts default-init from holdingsSummary; fingerprint-based identity |
| SCENARIO-02 | Each current holding can be toggled on/off; live portfolio untouched | Client-only toggleByScopeRef state; D-02 renormalization; LocalStorage persistence |
| SCENARIO-03 | Bridge recommendations surface inline with "Add to scenario" actions | D-05 Bridge inline path; ScenarioFlaggedHoldingsList evolution; BridgeDrawer extension |
| SCENARIO-04 | Allocator can browse verified strategies and add any | StrategyBrowseDrawer; getStrategiesByCategory + strategies with status=published query |
| SCENARIO-05 | Scenario composition computes projected KPIs + equity curve + drawdown (COMPLETE) | src/lib/scenario.ts computeScenario — already ships and is pinned by scenario.test.ts |
| SCENARIO-06 | Scenario deltas shown against live baseline with delta badges | KpiStrip mode="scenario" extension; D-16 direction-aware tokens; EquityChart overlay |
| SCENARIO-07 | "Commit scenario" routes each diff through Bridge outcome-recording flow | POST /api/allocator/scenario/commit; voluntary kind match_decisions; migration 080 |
| SCENARIO-08 | Scenario state is client-side localStorage; no DB persistence | scenario-state.ts; allocations.scenario_v0_15 storage key |
| SCENARIO-09 | "Reset scenario" discards draft and reinitializes from current live holdings | scenario-state.ts reset helper; destructive confirmation modal |

</phase_requirements>

---

## Summary

Phase 10 grows the Phase 09 read-only `ScenarioFlaggedHoldingsList` into a full interactive portfolio scenario composer. The foundational math engine (`src/lib/scenario.ts`) already ships and is regression-pinned — the planner must not touch it. Phase 10's work is pure orchestration: a typed draft-state module, a holdings-to-StrategyForBuilder adapter, three new right-slide-over components, KpiStrip and EquityChart overlay extensions, a new commit API route, and one database migration relaxing the Phase 09 XOR constraint with a per-kind enum discriminator.

The commit path is the most schema-sensitive work: voluntary toggle-off and voluntary add require synthetic `match_decisions` rows with a new `kind` column (`bridge_recommended | voluntary_remove | voluntary_add | voluntary_modify`). The existing `compute_bridge_outcome_deltas()` cron already covers the `original_holding_ref IS NOT NULL` branch (migration 073) and the `original_strategy_id` strategy branch — voluntary_remove satisfies the holding branch verbatim; voluntary_add satisfies the strategy branch (with `original_strategy_id NULL`). The cron's holding branch filters on `md.original_strategy_id IS NULL AND md.original_holding_ref IS NOT NULL` — voluntary_add rows have both NULL, so they do NOT enter either branch. Researcher finding: the cron will skip voluntary_add rows entirely unless extended. Whether this is acceptable (voluntary adds have no "held" baseline value to compare against) or must be patched in migration 080 is a planner decision.

A key open finding: `mandate_fit_score` does NOT live on the `strategies` table. It is engine-computed into `match_candidates.score_breakdown` JSONB for a specific allocator's universe at score time. The StrategyBrowseDrawer mandate-fit pill (D-08) cannot be pre-populated from a simple strategies query. The planner must choose: (a) derive the pill client-side from allocator preferences + strategy attributes (a lightweight approximation), or (b) join against the most recent `match_candidates` row for this allocator. Option (a) is the correct default for Phase 10 given the no-new-server-call constraint.

**Primary recommendation:** Build the scenario-state + adapter as pure TS modules first (testable without DOM), then wire into AllocationsTabs's Scenario tab body, then the UI layers. migration 080 ships in the same atomic commit as ADR-0023 sync.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Scenario draft state (toggle/weight/addedStrategies) | Browser / Client | — | localStorage + React state; no server persistence in v0.15 |
| KPI projection (computeScenario) | Browser / Client | — | Pure TS math in src/lib/scenario.ts; already client-side in /scenarios |
| holdingReturnsByScopeRef reconstruction | API / Backend (queries.ts) | — | D-04 — one-pass reconstruction from breakdown JSONB at SSR time; injected into payload |
| Strategy browse (all verified strategies) | API / Backend (queries.ts) | Browser / Client | Existing getStrategiesByCategory pattern; full list at drawer open |
| Commit routing (voluntary_remove + voluntary_add) | API / Backend (route.ts) | Database (RLS) | One transaction; synthetic match_decisions + bridge_outcomes; RLS owns ownership |
| Mandate-fit pill computation | Browser / Client | — | Lightweight approximation from allocator prefs + strategy attributes (see open finding) |
| Equity/drawdown overlay rendering | Browser / Client | — | SVG EquityChart extension; scenario DailyPoint[] computed client-side |
| Delta badge computation | Browser / Client | — | Subtraction of scenario vs live KPI values; pure TS |
| Bridge outcome commit audit | API / Backend (audit.ts) | Database (audit_log) | logAuditEvent("match.decision_record") per D-10/D-11 precedent |
| localStorage persistence + fingerprint | Browser / Client | — | Phase 08 idiom (allocations.showRevokedHoldings pattern) |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `src/lib/scenario.ts` (internal) | v2.1.0 semantics | Portfolio analytics engine | Already ships; regression-pinned; ZERO change allowed |
| React 19 (existing) | 19.x | Component state, hooks | Project standard |
| TypeScript (strict) | existing | Type safety | Project standard; strict mode enforced |
| Supabase JS (existing) | existing | DB writes for commit path | Project standard for user-scoped mutations |
| `next/navigation` (useSearchParams, useRouter) | Next.js App Router | Tab URL derivation (existing pattern) | Already used in AllocationsTabs |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@testing-library/react` + `vitest` (existing) | vitest 4.1.2 | Unit test all scenario logic | Every new module: scenario-state.ts, scenario-adapter.ts, drawers |
| `zod` (existing) | existing | Commit API route body validation | Same pattern as bridge/outcome/route.ts |
| `src/lib/audit.ts` (internal) | existing | Audit event emission on commit | logAuditEvent("match.decision_record") per ADR-0023 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Client-side computeScenario | Server-side API call for projection | Server call adds latency; scenario must recompute on every toggle/weight change — client-side is the right tier |
| localStorage for draft state | Supabase DB persistence | DB persistence is SCENARIO-08 explicit v0.15 deferral — not allowed |
| alias-substring search in browse drawer | Fuzzy search (fuse.js) | Adds a dep; project prohibits new deps; tens of strategies → O(n) substring is fine |
| Per-row independent atomicity on commit | Single transaction | Single transaction is stronger and matches project precedent; planner to confirm |

**Installation:** No new packages. Zero npm additions.

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (allocationTab="scenario")
  │
  ├─ useScenarioState(payload) ──────────────────────────────────────┐
  │    reads localStorage["allocations.scenario_v0_15"]              │
  │    default-init from holdingsSummary[] fingerprint               │
  │    emits: { toggleByScopeRef, addedStrategies, weightOverrides } │
  │                                                                   │
  ├─ ScenarioComposer                                                 │
  │    │                                                              │
  │    ├─ scenario-adapter.ts                                         │
  │    │    holdings → StrategyForBuilder[]                          │
  │    │    addedStrategies (pass-through)                           │
  │    │    returns unified StrategyForBuilder[] + ScenarioState     │
  │    │                                                             │
  │    ├─ computeScenario(strategies, state, dateMapCache)  ◄────────┘
  │    │    (src/lib/scenario.ts — UNCHANGED)
  │    │    returns ComputedMetrics { twr, cagr, sharpe, ... equity_curve }
  │    │
  │    ├─ KpiStrip mode="scenario"     (delta vs live baseline)
  │    ├─ EquityChart + scenarioSeries (overlay)
  │    ├─ DrawdownChart + scenarioSeries (overlay)
  │    ├─ ScenarioCompositionList      (toggle + weight + per-row delta)
  │    ├─ Bridge inline card           (when flaggedHoldings.length > 0)
  │    ├─ StrategyBrowseDrawer         (browse-add path)
  │    └─ ScenarioFooter               (sticky: diff count + commit CTA)
  │
  └─ On "Commit scenario"
       │
       └─ ScenarioCommitDrawer
            │   (grouped diff sections + inline RejectedForm + AllocatedForm)
            │
            └─ POST /api/allocator/scenario/commit
                 │
                 ├─ withAuth (ownership gate)
                 ├─ zod validation of commit payload
                 ├─ For each voluntary_remove diff:
                 │    INSERT match_decisions (kind='voluntary_remove', original_holding_ref, suggested_strategy_id NULL)
                 │    INSERT bridge_outcomes (kind='rejected', match_decision_id)
                 ├─ For each voluntary_add diff:
                 │    INSERT match_decisions (kind='voluntary_add', both original_* NULL, suggested_strategy_id)
                 │    INSERT bridge_outcomes (kind='allocated', match_decision_id)
                 ├─ For each bridge_recommended diff (Bridge "Add to scenario"):
                 │    Reuses existing /api/match/decisions/holding → sendBridgeIntro path
                 │    INSERT bridge_outcomes via existing /api/bridge/outcome path
                 ├─ logAuditEvent("match.decision_record") per row
                 └─ Returns { recorded: N }
```

### Recommended Project Structure

```
src/app/(dashboard)/allocations/
├── lib/
│   ├── scenario-state.ts          # NEW: draft state + localStorage + fingerprint
│   ├── scenario-adapter.ts        # NEW: holdings → StrategyForBuilder[] adapter
│   ├── holding-outcome-adapter.ts # EXTENDED: voluntary_remove + voluntary_add synthetic shapes
│   └── holdings-adapter.ts        # UNCHANGED
├── components/
│   ├── ScenarioComposer.tsx       # NEW: full Scenario tab body (or split into sub-files)
│   ├── ScenarioFooter.tsx         # NEW: sticky 56px bar
│   ├── ScenarioCommitDrawer.tsx   # NEW: 720px right slide-over + grouped diffs
│   ├── StrategyBrowseDrawer.tsx   # NEW: 620px right slide-over + search + pills
│   ├── KpiStrip.tsx               # EXTENDED: mode="scenario" variant
│   └── BridgeDrawer.tsx           # EXTENDED: "Add to scenario" CTA in confirm stage
├── widgets/performance/
│   ├── EquityChart.tsx            # EXTENDED: scenarioSeries prop
│   └── DrawdownChart.tsx          # EXTENDED: scenarioSeries prop
├── AllocationsTabs.tsx            # EXTENDED: Scenario tab body → ScenarioComposer under ui_v2 flag
├── ScenarioStub.tsx               # UNCHANGED for v1; Phase 10 wires v2 branch
└── ScenarioFlaggedHoldingsList.tsx # Consumed as a section within ScenarioComposer or evolved
src/app/api/allocator/scenario/commit/
└── route.ts                        # NEW: POST commit endpoint
supabase/migrations/
└── 0XX_match_decisions_kind_enum.sql  # NEW: migration 080 (next number after 079)
```

**Wiring point in AllocationsTabs.tsx (lines 365–377):**

```tsx
{activeTab === "scenario" && (
  isUiV2
    ? <ScenarioComposer {...scenarioProps} />   // Phase 10 — NEW
    : <ScenarioStub                             // v1 path — UNCHANGED
        flaggedHoldings={props.flaggedHoldings}
        matchDecisionsByHoldingRef={props.matchDecisionsByHoldingRef}
      />
)}
```

The `isUiV2` flag read already exists at line 82 (`UI_V2_STORAGE_KEY = "allocations.ui_v2"`). AllocationsTabs already has access to `MyAllocationDashboardPayload` props. The Scenario tab panel at lines 365–377 is the single wiring point — Phase 10 branches on `isUiV2` there.

**ScenarioFlaggedHoldingsList decision:** Consume as a section within `ScenarioComposer` (the Bridge inline card section), not evolved in-place. The read-only flagged list renders inside the composer body when `flaggedHoldings.length > 0`. The v1 path continues to reference `ScenarioFlaggedHoldingsList` directly via `ScenarioStub`. This avoids mutating the v1 code path while allowing the v2 composer to integrate the flagged list as a subsection.

---

### Pattern 1: scenario-state.ts — Draft State Module

[VERIFIED: codebase inspection of Phase 08 localStorage idiom (useDashboardConfig.test.ts)]

```typescript
// src/app/(dashboard)/allocations/lib/scenario-state.ts

export const SCENARIO_STORAGE_KEY = "allocations.scenario_v0_15";
export const SCENARIO_SCHEMA_VERSION = 1;

export interface ScenarioDraft {
  schema_version: number;
  init_holdings_fingerprint: string;
  toggleByScopeRef: Record<string, boolean>;  // true = enabled
  addedStrategies: Array<{ id: string; name: string; markets: string[]; strategy_types: string[] }>;
  weightOverrides: Record<string, number>;    // 0..1, renormalized subset
  lastEditedAt: string;                       // ISO timestamp
}

/**
 * Deterministic fingerprint of holdingsSummary — detects when live holdings
 * have changed since the draft was created. Use stable JSON.stringify over
 * sorted (symbol, venue, holding_type) tuples.
 */
export function computeHoldingsFingerprint(
  holdingsSummary: Array<{ symbol: string; venue: string; holding_type: string }>,
): string {
  const sorted = [...holdingsSummary]
    .sort((a, b) =>
      `${a.symbol}:${a.venue}:${a.holding_type}`.localeCompare(
        `${b.symbol}:${b.venue}:${b.holding_type}`,
      ),
    )
    .map((h) => `${h.symbol}:${h.venue}:${h.holding_type}`);
  // Lightweight hash — concatenate sorted scope_refs, then a simple djb2 variant.
  // Full crypto hash is overkill; collision resistance is not required (fingerprint
  // is only used to detect structural live-holdings change, not for security).
  return sorted.join("|");
}

/** SSR-safe localStorage read. Returns null on SSR or quota errors. */
export function loadScenarioDraft(): ScenarioDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SCENARIO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScenarioDraft;
    if (parsed.schema_version !== SCENARIO_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** SSR-safe localStorage write. Swallows quota errors (Safari private-mode). */
export function saveScenarioDraft(draft: ScenarioDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Quota exceeded or Safari private mode — draft not persisted; silent fail.
  }
}

export function clearScenarioDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SCENARIO_STORAGE_KEY);
  } catch {}
}
```

### Pattern 2: scenario-adapter.ts — Holdings → StrategyForBuilder

[VERIFIED: src/lib/scenario.ts StrategyForBuilder interface inspection]

```typescript
// src/app/(dashboard)/allocations/lib/scenario-adapter.ts

import type { StrategyForBuilder, ScenarioState, DailyPoint } from "@/lib/scenario";
import { buildHoldingRef } from "./holding-outcome-adapter";

export interface ScenarioAdapterInputs {
  holdingsSummary: Array<{
    symbol: string; venue: string; holding_type: "spot" | "derivative"; value_usd: number;
  }>;
  /** From extended payload — D-04 reconstruction. */
  holdingReturnsByScopeRef: Record<string, DailyPoint[]>;
  /** From payload strategies[] — already StrategyForBuilder-compatible. */
  addedStrategies: StrategyForBuilder[];
  toggleByScopeRef: Record<string, boolean>;
  weightOverrides: Record<string, number>;
  /** Warm-up gate: if a holding's return series has < this many points, exclude. */
  minReturnDays?: number; // default 30 (Phase 07 D-03 mirror)
}

export function buildStrategyForBuilderSet(
  inputs: ScenarioAdapterInputs,
): { strategies: StrategyForBuilder[]; state: ScenarioState } {
  const { holdingsSummary, holdingReturnsByScopeRef, addedStrategies,
          toggleByScopeRef, weightOverrides } = inputs;
  const minDays = inputs.minReturnDays ?? 30;

  // Holdings → StrategyForBuilder (D-01)
  const holdingStrategies: StrategyForBuilder[] = holdingsSummary.flatMap((h) => {
    const scopeRef = buildHoldingRef(h);
    const dailyReturns = holdingReturnsByScopeRef[scopeRef] ?? [];
    if (dailyReturns.length < minDays) return []; // warm-up gate
    return [{
      id: scopeRef,                // "holding:{venue}:{symbol}:{holding_type}"
      name: h.symbol,
      codename: null,
      disclosure_tier: "public",
      strategy_types: [],
      markets: [h.venue],
      start_date: dailyReturns[0]?.date ?? null,
      daily_returns: dailyReturns,
      cagr: null, sharpe: null, volatility: null, max_drawdown: null,
    }];
  });

  const allStrategies = [...holdingStrategies, ...addedStrategies];
  const totalValue = holdingsSummary.reduce((s, h) => s + h.value_usd, 0);

  // ScenarioState: selected + weights + startDates
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  const startDates: Record<string, string> = {};

  for (const s of allStrategies) {
    selected[s.id] = toggleByScopeRef[s.id] ?? true; // default enabled
    const override = weightOverrides[s.id];
    if (override != null) {
      weights[s.id] = override;
    } else {
      // Default weight from live value_usd for holdings, 0 for added strategies
      const h = holdingsSummary.find((x) => buildHoldingRef(x) === s.id);
      weights[s.id] = totalValue > 0 && h ? h.value_usd / totalValue : 0;
    }
    startDates[s.id] = s.start_date ?? "2022-01-01";
  }

  return { strategies: allStrategies, state: { selected, weights, startDates } };
}
```

### Pattern 3: holdingReturnsByScopeRef Reconstruction (D-04)

[VERIFIED: equitySnapshots.breakdown shape in MyAllocationDashboardPayload, migration 070]

The `allocator_equity_snapshots.breakdown` column carries a JSONB object `{ "BTC": 50000, "ETH": 30000, ... }` (USD values per symbol per `asof` date). To produce `holdingReturnsByScopeRef: Record<scope_ref, DailyPoint[]>`:

```typescript
// In getMyAllocationDashboard (src/lib/queries.ts), alongside equityDailyPoints computation:

function reconstructHoldingReturnsByScopeRef(
  equitySnapshots: Array<{ asof: string; breakdown: Record<string, number> | null }>,
  holdingsSummary: Array<{ symbol: string; venue: string; holding_type: string }>,
): Record<string, DailyPoint[]> {
  // Build per-symbol ascending USD series from breakdown
  const symbolSeriesUSD = new Map<string, Array<{ asof: string; value: number }>>();
  for (const snap of equitySnapshots) {
    if (!snap.breakdown) continue;
    for (const [symbol, value] of Object.entries(snap.breakdown)) {
      if (!symbolSeriesUSD.has(symbol)) symbolSeriesUSD.set(symbol, []);
      symbolSeriesUSD.get(symbol)!.push({ asof: snap.asof, value });
    }
  }
  // Sort ascending and difference to daily returns
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

**Caveats:** (1) `breakdown` keyed by symbol only (no venue disambiguation — if allocator holds BTC on Binance AND OKX, the breakdown merges them). The scope_ref distinguishes venue, but the breakdown does not — researcher finding: for Phase 10, map symbol → ALL holdings with that symbol across venues (reasonable approximation; Phase 09 Python engine uses the same logic). (2) This reconstruction belongs in `getMyAllocationDashboard` or its helper, NOT in the component tree — compute once at SSR time.

### Pattern 4: Migration 080 — kind Enum + per-kind CHECK (Path A)

[VERIFIED: migration 072 XOR constraint body; migration 073 cron holding branch]

```sql
-- 075_match_decisions_kind_enum.sql
BEGIN;
SET lock_timeout = '3s';

-- STEP 1: Create kind enum type
DO $$ BEGIN
  CREATE TYPE match_decision_kind AS ENUM (
    'bridge_recommended',
    'voluntary_remove',
    'voluntary_add',
    'voluntary_modify'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- STEP 2: Add kind column (nullable initially for backfill)
ALTER TABLE match_decisions
  ADD COLUMN IF NOT EXISTS kind match_decision_kind;

-- STEP 3: Backfill existing rows → 'bridge_recommended'
-- All pre-Phase-10 rows satisfy: suggested_strategy_id NOT NULL AND
-- (original_strategy_id IS NOT NULL XOR original_holding_ref IS NOT NULL).
UPDATE match_decisions
  SET kind = 'bridge_recommended'
  WHERE kind IS NULL;

-- STEP 4: Set NOT NULL after backfill
ALTER TABLE match_decisions
  ALTER COLUMN kind SET NOT NULL;
ALTER TABLE match_decisions
  ALTER COLUMN kind SET DEFAULT 'bridge_recommended';

-- STEP 5: DROP the Phase 09 XOR constraint
ALTER TABLE match_decisions
  DROP CONSTRAINT IF EXISTS match_decisions_original_xor;

-- STEP 6: Add per-kind invariant CHECKs
ALTER TABLE match_decisions
  ADD CONSTRAINT match_decisions_kind_bridge_recommended CHECK (
    kind != 'bridge_recommended' OR (
      suggested_strategy_id IS NOT NULL
      AND (original_strategy_id IS NOT NULL OR original_holding_ref IS NOT NULL)
    )
  );
ALTER TABLE match_decisions
  ADD CONSTRAINT match_decisions_kind_voluntary_remove CHECK (
    kind != 'voluntary_remove' OR (
      original_holding_ref IS NOT NULL
      AND suggested_strategy_id IS NULL
      AND original_strategy_id IS NULL
    )
  );
ALTER TABLE match_decisions
  ADD CONSTRAINT match_decisions_kind_voluntary_add CHECK (
    kind != 'voluntary_add' OR (
      suggested_strategy_id IS NOT NULL
      AND original_holding_ref IS NULL
      AND original_strategy_id IS NULL
    )
  );
ALTER TABLE match_decisions
  ADD CONSTRAINT match_decisions_kind_voluntary_modify CHECK (
    kind != 'voluntary_modify' OR (
      original_holding_ref IS NOT NULL
      AND suggested_strategy_id IS NULL
    )
  );

-- STEP 7: Self-verifying DO block
DO $$
DECLARE
  v_backfill_nulls INT;
BEGIN
  -- (a) No null kind values remain
  SELECT COUNT(*) INTO v_backfill_nulls FROM match_decisions WHERE kind IS NULL;
  IF v_backfill_nulls > 0 THEN
    RAISE EXCEPTION 'migration 080 assertion (a): % rows have NULL kind after backfill', v_backfill_nulls;
  END IF;
  -- (b) Old XOR constraint gone
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.match_decisions'::regclass
      AND conname = 'match_decisions_original_xor'
  ) THEN
    RAISE EXCEPTION 'migration 080 assertion (b): match_decisions_original_xor still present';
  END IF;
  -- (c) Kind enum exists
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'match_decision_kind') THEN
    RAISE EXCEPTION 'migration 080 assertion (c): match_decision_kind enum not found';
  END IF;
  RAISE NOTICE 'phase10: match_decisions kind enum deployed, XOR relaxed ✓';
  RAISE NOTICE 'migration 080: all self-verification assertions passed.';
END $$;

COMMIT;
```

### Pattern 5: KpiStrip mode="scenario" Extension

[VERIFIED: src/app/(dashboard)/allocations/components/KpiStrip.tsx inspection]

Add `mode?: "live" | "scenario"` and `scenarioMetrics?: ComputedMetrics` props. When `mode === "scenario"`, each cell renders:
- Primary value: scenario metric value (from `scenarioMetrics`)
- Delta pill below: `delta = scenario - live` (direction-aware)
- Hover tooltip: "Live: {liveValue}"

The existing `warmingUp` gate and `warmupHelper` sub-lines are PRESERVED VERBATIM under `mode === "live"` (the Performance tab's KpiStrip). Under `mode === "scenario"`, when `warmingUp` is true for the live baseline, delta pills are suppressed ("—" with no delta rather than a misleading delta computed from incomplete live data).

```typescript
// Additions to KpiStrip.tsx:
interface KpiStripProps {
  // ... existing props unchanged ...
  mode?: "live" | "scenario";
  /** Required when mode="scenario": the projected ComputedMetrics from computeScenario() */
  scenarioMetrics?: ComputedMetrics | null;
  /** Required when mode="scenario": the live baseline ComputedMetrics for delta computation */
  liveMetrics?: ComputedMetrics | null;
}

// Delta pill rendering — per D-16 direction-aware rules:
type KpiDirection = "up-good" | "down-good";
const KPI_DIRECTION: Record<string, KpiDirection> = {
  twr: "up-good", cagr: "up-good", sharpe: "up-good",
  sortino: "up-good", aum: "up-good", score: "up-good",
  max_drawdown: "down-good", volatility: "down-good", avg_correlation: "down-good",
};

function deltaPillClass(delta: number | null, direction: KpiDirection): string {
  if (delta == null) return "text-text-muted";
  const improved = direction === "up-good" ? delta > 0 : delta < 0;
  const regressed = direction === "up-good" ? delta < 0 : delta > 0;
  if (improved) return "text-positive";
  if (regressed) return "text-negative";
  return "text-text-muted"; // noise floor
}
```

### Pattern 6: EquityChart Overlay Extension

[VERIFIED: src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx — OverlaySeries type already exists]

The `EquityChart` already accepts `overlays?: OverlaySeries[]` where each overlay is `{ id, label, color, points: DailyPoint[] }`. The scenario series plugs directly into this existing prop:

```typescript
// In ScenarioComposer.tsx, when passing scenarioSeries to EquityChart:
const scenarioOverlay: OverlaySeries | undefined = scenarioEquityCurve.length > 0 ? {
  id: "scenario",
  label: "Scenario",
  color: "var(--color-chart-strategy)",  // --color-chart-strategy = #1B6B5A accent teal
  points: scenarioEquityCurve,  // from computeScenario().equity_curve converted to DailyPoint[]
} : undefined;

// Live baseline rendered as the primary equityDailyPoints prop (already muted/benchmark color).
// Scenario rendered as an overlay with accent color.
```

The 3-state toggle "Live · Scenario · Both" (D-14) is implemented as a new `visibilityMode` prop on EquityChart (or a local state toggle inside the chart that hides/shows the overlay and primary series).

**DrawdownChart is different:** `DrawdownChart` uses Recharts (not the SVG EquityChart pattern). It accepts `equityDailyPoints?: DailyPoint[]` and computes drawdown via `deriveSnapshotDrawdowns()`. Adding a scenario drawdown series requires passing a second `scenarioDailyPoints?: DailyPoint[]` prop and rendering a second `<Area>` series on the same Recharts `<AreaChart>`. The `deriveSnapshotDrawdowns()` function is already exported and unit-tested — apply it to the scenario equity curve to get the scenario drawdown series.

### Pattern 7: Commit API Route Shape

[VERIFIED: src/app/api/bridge/outcome/route.ts + src/app/api/match/decisions/holding/route.ts]

```typescript
// POST /api/allocator/scenario/commit/route.ts

const CommitDiffSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("voluntary_remove"),
    holding_ref: z.string().regex(/^holding:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/),
    rejection_reason: z.enum(REJECTION_REASONS).optional(),
    note: z.string().max(2000).nullish(),
    size_at_decision_usd: z.number().positive(),
    effective_date: z.string().date(),
  }),
  z.object({
    kind: z.literal("voluntary_add"),
    strategy_id: z.string().uuid(),
    percent_allocated: z.number().min(0.1).max(50),
    effective_date: z.string().date(),
    note: z.string().max(2000).nullish(),
    size_at_decision_usd: z.number().positive(),
  }),
  z.object({
    kind: z.literal("voluntary_modify"),
    holding_ref: z.string().regex(/^holding:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/),
    new_weight: z.number().min(0).max(1),
    note: z.string().max(2000).nullish(),
  }),
  z.object({
    kind: z.literal("bridge_recommended"),
    // Delegates to existing match/decisions/holding + bridge/outcome paths
    holding_ref: z.string().regex(/^holding:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/),
    strategy_id: z.string().uuid(),
    percent_allocated: z.number().min(0.1).max(50),
    effective_date: z.string().date(),
    note: z.string().max(2000).nullish(),
  }),
]);

const CommitBodySchema = z.object({
  diffs: z.array(CommitDiffSchema).min(1).max(50),
});
```

The route uses `withAuth`, inserts all rows in a single transaction (supabase admin client for match_decisions writes, since match_decisions lacks allocator self-INSERT RLS). Rate-limits via `userActionLimiter`. Emits `logAuditEvent("match.decision_record")` per diff.

### Anti-Patterns to Avoid

- **Touching src/lib/scenario.ts:** ZERO changes allowed. Any behavior change is a regression against scenario.test.ts pins. The adapter produces StrategyForBuilder[] that feeds computeScenario() verbatim.
- **Computing holdingReturnsByScopeRef in the component:** This belongs in `getMyAllocationDashboard()` in queries.ts. Computing it on every render in the component tree wastes cycles and re-derives on every tab switch.
- **Using the equity_curve output directly as DailyPoint[]:** `computeScenario().equity_curve` is downsampled (every 5 business days) and carries cumulative RETURN (0.18 = +18%). `EquityChart` expects cumulative WEALTH (1.18). Apply `value + 1` conversion. `DrawdownChart`'s `deriveSnapshotDrawdowns()` expects cumulative USD values — convert scenario equity curve from return to wealth multiplier, then scale by scenario AUM.
- **Querying strategies inside the browse drawer on every filter change:** Load the full verified-strategy list once on drawer open, filter client-side. No server round-trip per filter.
- **Reading mandate_fit_score from strategies table:** It does not exist there. See open question.
- **Not wrapping localStorage in try/catch:** Safari private mode throws on setItem. All existing project localStorage code follows the try/catch pattern — do the same.
- **Bumping LAYOUT_VERSION:** Scenario tab is NOT a react-grid-layout widget grid. LAYOUT_VERSION stays at 4.
- **Calling sendBridgeIntro in the commit route for bridge_recommended diffs:** The commit route should directly insert match_decisions with kind='bridge_recommended' (the intro was already recorded when the allocator clicked "Add to scenario"). The commit route records the OUTCOME, not the intro.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Portfolio math (TWR/CAGR/Vol/Sharpe/Sortino/MaxDD/correlation) | Custom formulas | `computeScenario()` in `src/lib/scenario.ts` | 5 behavioral invariants pinned in regression suite; custom formulas would drift from live methodology |
| Weight renormalization | Custom normalize function | Pattern from ScenarioState: `totalWeight > 0 ? w[id]/totalWeight : 0` | Already implemented inside computeScenario; expose the same normalization at the state layer |
| Daily-return-to-drawdown conversion | Custom drawdown calc | `deriveSnapshotDrawdowns()` in DrawdownChart.tsx — already exported | Unit-tested; uses correct peak-from-first-value anchoring |
| Holdings → strategy-shaped adapter | New join logic | `buildHoldingRef()` from `holding-outcome-adapter.ts` + `buildDateMapCache()` from `scenario.ts` | Scope_ref format is locked; dateMapCache is already O(n) optimal |
| Slide-over / drawer component | Custom drawer | Pattern-match `BridgeDrawer.tsx` (Phase 09.1 D-16) — backdrop, focus-trap, escape-to-close, 620/720px width | Existing bespoke drawer is already accessible and tested; no third-party library needed |
| Form validation for commit payload | Custom zod schema | Discriminated union on `kind` — see Pattern 7 | Pattern matches bridge/outcome/route.ts shape exactly |
| Toggle switch | Custom toggle | Pattern-match Phase 09.1 existing toggle (32×18px track, 150ms ease-out, accent fill) from HoldingsTable | Already accessible (role="switch", aria-checked) and design-token-compliant |
| localStorage fingerprint | MD5/SHA | Sorted scope_ref string concatenation | Collision resistance not required; simple string is deterministic and fast |

---

## Runtime State Inventory

> Phase 10 is a NEW feature addition, not a rename/refactor/migration phase.

**Stored data:** No existing scenario state in any datastore — Phase 10 creates the `allocations.scenario_v0_15` localStorage key fresh. No migration of stored data required.

**Live service config:** No external service config references a "scenario" concept from Phase 10 that would need to be updated.

**OS-registered state:** None.

**Secrets/env vars:** None new. The commit API route uses the existing Supabase service role key (already in env).

**Build artifacts:** None — Phase 10 ships no new CLI tools or installable packages.

**migration 080 (DB state change):** The `match_decisions` table XOR constraint is relaxed and a `kind` enum column is added. Existing rows are backfilled to `kind='bridge_recommended'`. No data loss; the constraint relaxation is backward-compatible with all existing application code (the old code only ever inserted rows satisfying the bridge_recommended invariant).

---

## Common Pitfalls

### Pitfall 1: equity_curve Return vs Wealth Confusion

**What goes wrong:** `computeScenario().equity_curve` values are cumulative RETURN (0.18 = +18% gain from inception). `computeCompositeCurve()` adds 1 to produce cumulative WEALTH (1.18). `EquityChart` expects wealth (starting at 1.0). If you pass equity_curve directly, the chart starts at 0.0 rather than 1.0.

**Why it happens:** The two functions have different output conventions — `computeScenario()` returns return; `computeCompositeCurve()` returns wealth. The comment at `scenario.ts:398-402` documents this conversion.

**How to avoid:** In `scenario-adapter.ts`, always apply `{ date, value: point.value + 1 }` when converting `ComputedMetrics.equity_curve` to `OverlaySeries.points` for EquityChart.

**Warning signs:** Scenario equity curve starts flat at 0.0% on the chart; live baseline starts at ~100%.

### Pitfall 2: Scope_ref Collision Between Holdings and Added Strategies

**What goes wrong:** A holding's `id` in `StrategyForBuilder` is `"holding:binance:BTC:spot"`. A strategy's `id` is a UUID. If an added strategy UUID somehow collides with a holding scope_ref (impossible by construction but easy to break if the ID assignment logic is wrong), `computeScenario()` will produce incorrect weights.

**Why it happens:** `scenario-adapter.ts` builds a unified array from both holdings and strategies. If the adapter assigns IDs incorrectly (e.g., using symbol string instead of scope_ref), UUID strategies will not be distinguishable from holding pseudo-IDs.

**How to avoid:** Holdings MUST use `buildHoldingRef(h)` = `"holding:{venue}:{symbol}:{holding_type}"`. Added strategies pass through their UUID `strategy.id` unchanged. Assertion test: `scenarioAdapter.test.ts` verifies no ID in the unified array is both a UUID and a scope_ref.

**Warning signs:** CI test `scenario-adapter.test.ts` failing on ID uniqueness assertions.

### Pitfall 3: localStorage Safari Private Mode QuotaExceededError

**What goes wrong:** `localStorage.setItem()` throws `QuotaExceededError` in Safari private browsing. The scenario draft is not persisted; worse, the exception propagates and crashes the component tree.

**Why it happens:** Safari private mode has a 0-byte localStorage quota. Unlike Chrome, it throws rather than silently failing.

**How to avoid:** All localStorage writes use try/catch (per Phase 08 `allocations.showRevokedHoldings` precedent). The `saveScenarioDraft()` function swallows the exception silently.

**Warning signs:** Scenario tab crashes on Safari private mode open; draft never persists.

### Pitfall 4: Fingerprint Mismatch on Every Tab Mount

**What goes wrong:** The fingerprint comparison runs on every Scenario tab activation. If `holdingsSummary` is re-sorted on every query (non-deterministic Supabase ordering), the fingerprint computation produces a different string even when holdings haven't changed.

**Why it happens:** `computeHoldingsFingerprint()` sorts by scope_ref, which is deterministic. But if the payload's `holdingsSummary` array is not sorted consistently, the sorted-by-scope_ref result might differ between loads if new holdings were added.

**How to avoid:** The fingerprint sorts by `symbol:venue:holding_type` (the three discriminants of a scope_ref) — this is always the same for the same set of holdings regardless of payload order. The real mismatch trigger is genuinely new holdings being added. Test in `scenario-state.localStorage.test.ts`: same-set-different-order → same fingerprint.

**Warning signs:** Fingerprint mismatch banner shows on every tab activation even when holdings haven't changed.

### Pitfall 5: Delta Cron Skips voluntary_add Rows

**What goes wrong:** `compute_bridge_outcome_deltas()` (migration 073) has two branches: strategy branch (`original_strategy_id IS NOT NULL OR match_decision_id IS NULL`) and holding branch (`original_strategy_id IS NULL AND original_holding_ref IS NOT NULL`). A `voluntary_add` row has `original_strategy_id IS NULL, original_holding_ref IS NULL, suggested_strategy_id IS NOT NULL`. It satisfies NEITHER branch — the cron skips it silently.

**Why it happens:** The cron was built for two cases: (1) strategy-sourced decisions and (2) holding-sourced decisions. Voluntary adds introduce a third case: strategy allocation with no original holding baseline.

**How to avoid:** voluntary_add coverage requires a third cron branch added in migration 080 alongside the kind enum. Migration 080 (Plan 02) ships the kind enum AND extends the cron in `compute_bridge_outcome_deltas()` with a third CTE branch matching `md.kind='voluntary_add'` (i.e. `md.suggested_strategy_id IS NOT NULL AND md.original_strategy_id IS NULL AND md.original_holding_ref IS NULL`). The DO block asserts the branch exists and produces a delta for a fixture voluntary_add row. Without this third branch, voluntary_add rows satisfy NEITHER existing branch in migration 073 and are silently skipped — `delta_30d/90d/180d` would remain NULL forever, breaking the "Bridge recommendations actually worked" closed feedback loop the product depends on. The earlier "the existing strategy branch will pick it up" justification was factually wrong: that branch's filter requires `md.original_strategy_id IS NOT NULL OR bo.match_decision_id IS NULL`, neither of which a voluntary_add row satisfies.

**Warning signs:** `delta_30d` remains NULL for voluntary_add rows after 30 days; DO block fixture-row assertion fails on apply.

### Pitfall 6: match_decisions Admin Client Requirement on Commit Route

**What goes wrong:** Inserting into `match_decisions` with the user-scoped Supabase client fails with "permission denied" because `match_decisions` lacks allocator self-INSERT RLS policies (per queries.ts comment at line 684-686: "no allocator-self-SELECT RLS policy on that table").

**Why it happens:** match_decisions RLS is admin-only for writes (the engine inserts via service role; the existing `/api/match/decisions/holding` route uses `createAdminClient()` for the INSERT).

**How to avoid:** The commit route MUST use `createAdminClient()` for `match_decisions` inserts, with an explicit `.eq("allocator_id", userId)` ownership gate (same pattern as queries.ts:968-976 and the existing holding route). The `bridge_outcomes` table uses the user-scoped client (standard ownership-RLS pattern — the bridge/outcome route uses `createClient()`).

**Warning signs:** 403 or permission error on commit when testing against a real Supabase instance.

### Pitfall 7: mandate_fit_score Not on strategies Table

**What goes wrong:** The browse drawer's mandate-fit pill is specified as "from existing mandate_fit_score on the strategy" (CONTEXT D-08). But `mandate_fit_score` is computed engine-side into `match_candidates.score_breakdown` JSONB — it is NOT a column on the `strategies` table. A naive `strategies.mandate_fit_score` query returns nothing.

**Why it happens:** The engine computes mandate fit against a SPECIFIC ALLOCATOR'S preferences at batch time. The score is allocator-relative, not absolute — a strategy that fits one allocator's mandate perfectly may fit another's poorly.

**How to avoid:** For the browse drawer pill, compute an approximation client-side from the allocator's mandate preferences (already on the dashboard payload via `mandate`) and the strategy's attributes (`strategy_types`, `markets`). A lightweight approach: check if the strategy's markets overlap the allocator's permitted markets, check if the strategy type is excluded, check if AUM tier meets the threshold. This is a rough approximation but is consistent with D-08's "informational only, no filtering" semantics. Alternatively, join against the most recent `match_candidates` row for this allocator — but that requires an admin-client query with an allocator_id gate. Researcher recommendation: client-side approximation from mandate preferences + strategy fields (zero extra server query; consistent with "no new server calls" goal).

**Warning signs:** Browse drawer pill shows wrong scores; or "mandate_fit_score" column missing error in query.

### Pitfall 8: Weight Input State vs. computeScenario Internal Normalization

**What goes wrong:** `computeScenario()` internally normalizes weights via `normWeight(id) = weights[id] / totalWeight`. If the UI shows weights as "renormalized" values but the `ScenarioState.weights` stores raw/un-normalized values, there's a display/compute mismatch — the KPI strip shows one thing, the weight inputs show another.

**Why it happens:** `ScenarioState.weights` semantics allow "any non-negative" per the docstring — renormalization happens inside `computeScenario()`. But the UI must display the user-visible normalized %, not the raw internal weight.

**How to avoid:** `scenario-state.ts` stores weights in 0..1 normalized form (summing to 1.0 across enabled rows). Renormalization happens in `scenario-state.ts` on every toggle/add, NOT inside `computeScenario()`. The weight inputs display `weightOverrides[id] * 100`%. The `ScenarioState.weights` passed to `computeScenario()` matches the displayed values exactly. Test: `scenario-state.test.ts` verifies `sum(weights[enabled]) === 1.0` after every toggle and add operation.

---

## Code Examples

### Renormalization after Toggle (D-02)

```typescript
// Source: scenario-state.ts (to be created)
// When a holding is toggled off:
function renormalizeWeights(
  weights: Record<string, number>,
  enabled: string[],  // ids that are still ON
): Record<string, number> {
  const sum = enabled.reduce((s, id) => s + (weights[id] ?? 0), 0);
  if (sum === 0) {
    // Equal distribution fallback
    const equal = enabled.length > 0 ? 1 / enabled.length : 0;
    return Object.fromEntries(enabled.map((id) => [id, equal]));
  }
  return Object.fromEntries(enabled.map((id) => [id, (weights[id] ?? 0) / sum]));
}
```

### Browse-add Weight Allocation (D-03)

```typescript
// Source: scenario-state.ts
// When a strategy is added via StrategyBrowseDrawer:
function addStrategyBrowse(
  weights: Record<string, number>,
  enabledIds: string[],  // currently enabled BEFORE adding
  newStrategyId: string,
): Record<string, number> {
  const n = enabledIds.length;
  const newWeight = 1 / (n + 1);
  const scaleFactor = 1 - newWeight;  // remaining space for existing
  const result: Record<string, number> = {};
  for (const id of enabledIds) {
    result[id] = (weights[id] ?? 0) * scaleFactor;
  }
  result[newStrategyId] = newWeight;
  return result;
}
```

### Bridge-add Weight Allocation (D-03)

```typescript
// Source: scenario-state.ts
// When a strategy is added via "Add to scenario" from a flagged holding's candidate:
function addStrategyBridge(
  weights: Record<string, number>,
  holdingScopeRef: string,   // the flagged holding's scope_ref
  newStrategyId: string,
): Record<string, number> {
  // The new strategy takes the flagged holding's current weight.
  // The holding REMAINS in the composition (allocator may later toggle it off).
  return {
    ...weights,
    [newStrategyId]: weights[holdingScopeRef] ?? 0,
  };
  // Note: sum > 1.0 after this operation. computeScenario() normalizes internally.
  // The UI should renormalize immediately to show weights summing to 1.0:
  // enabled = [...enabledIds, newStrategyId]
  // return renormalizeWeights(result, enabled);
}
```

### vi.stubGlobal localStorage Pattern for Tests

```typescript
// Source: src/app/(dashboard)/allocations/hooks/useDashboardConfig.test.ts (verified)
// Use this pattern in scenario-state.localStorage.test.ts:
const store = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
  removeItem: vi.fn((key: string) => { store.delete(key); }),
  clear: vi.fn(() => { store.clear(); }),
  get length() { return store.size; },
  key: vi.fn(() => null),
};
vi.stubGlobal("localStorage", localStorageMock);
```

### Drawdown Chart Scenario Extension

```typescript
// Source: DrawdownChart.tsx (verified — deriveSnapshotDrawdowns already exported)
// Add to DrawdownChart.tsx:
interface DrawdownChartProps extends WidgetProps {
  equityDailyPoints?: DailyPoint[];
  scenarioEquityPoints?: DailyPoint[] | null;  // NEW: scenario overlay
}

// In DrawdownChart component:
const scenarioDrawdownData = useMemo(
  () => scenarioEquityPoints ? deriveSnapshotDrawdowns(
    // Convert cumulative return to wealth (deriveSnapshotDrawdowns expects USD/wealth units)
    scenarioEquityPoints.map((p) => ({ date: p.date, value: p.value * totalScenarioAum }))
  ) : [],
  [scenarioEquityPoints, totalScenarioAum]
);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Scenario as "/scenarios" standalone sandbox only | Scenario tab embedded in /allocations with live portfolio context | Phase 09 D-08 (read-only seed) → Phase 10 (full composer) | Allocators no longer need to context-switch; Bridge recommendations and scenario composition share the same surface |
| Portfolio-level bridge_outcomes only | Per-holding voluntary diffs also recorded as bridge_outcomes via synthetic match_decisions | Phase 10 D-10/D-11 | Full outcome graph coverage; daily delta cron processes all outcomes |
| match_decisions XOR constraint (strategy-or-holding, never both-null) | Per-kind invariant CHECKs replacing XOR | Phase 10 migration 080 | voluntary_remove (both original_* meaningful), voluntary_add (both original_* NULL) are now schema-valid |
| KpiStrip shows live-only values | KpiStrip mode="scenario" shows projected values + delta badges vs live | Phase 10 D-13 | Allocators see impact of scenario changes at a glance without opening charts |

**Deprecated/outdated within this phase:**
- `ScenarioStub` "coming soon" card: replaced by `ScenarioComposer` under `allocations.ui_v2` flag. `ScenarioStub` continues to gate the v1 path unchanged.
- Phase 09 XOR constraint (`match_decisions_original_xor`): replaced by per-kind CHECK constraints in migration 080.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | mandate_fit_score can be approximated client-side from allocator mandate preferences + strategy attributes for the browse drawer pill | Pitfall 7, Architecture Patterns | If the approximation is too inaccurate, the pill may mislead allocators; mitigation: pill is "informational only" per D-08 |
| A2 | Migration 080 ships a third CTE branch in `compute_bridge_outcome_deltas()` matching `md.kind='voluntary_add'` (both original_* NULL, suggested_strategy_id NOT NULL); the DO block asserts the branch fires for a fixture row | Pitfall 5 | If the third branch is omitted, voluntary_add rows are silently skipped forever (delta_30d/90d/180d remain NULL), breaking the "Bridge recommendations actually worked" feedback loop. Earlier "the existing strategy branch will pick it up" claim was factually wrong and is corrected in Pitfall 5. |
| A3 | DrawdownChart should receive scenario equity values scaled by scenario AUM to compute drawdown ratio | Code Examples | If the scenario equity curve is in wealth multiplier form (not USD), the drawdown ratio computation still works correctly (ratio is unit-independent); A3 is a belt-and-suspenders concern |
| A4 | The breakdown JSONB symbol key is sufficient for holdings disambiguation across venues (when same symbol held on multiple exchanges) | Pattern 3 | Allocators with BTC on both Binance and OKX would see a merged return series; scope_refs for both venues would map to the same symbol series; Phase 10 inherits this limitation from the Python engine |

**If this table is empty for verified claims:** All structural claims above were verified by codebase inspection (migrations, component files, queries.ts). Only the 4 items above are approximations or assumptions.

---

## Open Questions (RESOLVED)

1. **voluntary_add rows and the delta cron** — **RESOLVED (REVISED post-cross-review):** Plan 02 Task 1 ships a third CTE branch in `compute_bridge_outcome_deltas()` ATOMICALLY in migration 080 alongside the kind enum (option a — extend the cron). The branch fires when `md.kind='voluntary_add'` and joins on `suggested_strategy_id` to fill `delta_30d/90d/180d` once `strategy_analytics.returns_series` covers `allocated_at`. The DO block asserts the branch exists and produces a delta for a fixture voluntary_add row. The earlier deferral (option b) was based on the false claim that the existing strategy branch would pick it up — corrected in Pitfall 5.
   - Original question: migration 073 cron has two branches; voluntary_add satisfies neither (both original_* NULL, suggested_strategy_id IS NOT NULL). Whether the cron should process voluntary_add rows or accept NULL-forever was an open product decision.

2. **Bridge-recommended commit flow in ScenarioCommitDrawer** — **RESOLVED:** Plan 07 commit route creates the synthetic `match_decision` server-side at commit time (NOT at "Add to scenario" time). The route accepts a discriminated union of diff kinds; the `bridge_recommended` branch creates both rows in a single server transaction with the admin client + `.eq("allocator_id", user.id)` ownership gate. This avoids storing `matchDecisionId` in localStorage drafts (which could go stale if the strategy was deleted).
   - Original question: Does "Add to scenario" in BridgeDrawer trigger `sendBridgeIntro` (creates match_decision at add time), or does the commit route create it? Decision: commit route creates it.

3. **strategies query for StrategyBrowseDrawer** — **RESOLVED:** Plan 03 Task 2 creates `GET /api/strategies/browse` (lazy fetch on drawer open). The route returns all published strategies with the fields needed for the drawer row (alias, codename, markets, strategy_types, mandate-fit approximation inputs). NOT bundled into the dashboard payload (avoids bloating the SSR query).
   - Original question: Where to source verified-strategy catalog for the browse drawer (the dashboard payload's `strategies[]` is scoped to allocator's portfolio join).

---

## Environment Availability

Phase 10 is purely code + migration changes with no new external dependencies. All external services (Supabase, Vercel) are already in use.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase Postgres | migration 080, commit route | ✓ | 17 (from supabase/config.toml) | — |
| Vitest | Test suite | ✓ | 4.1.2 | — |
| zod | Commit route validation | ✓ | existing | — |

**No missing dependencies with fallback or blocking issues.**

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | vitest.config.ts |
| Quick run command | `npm test -- --reporter=verbose scenario` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCENARIO-01 | Draft initializes from holdingsSummary with all enabled + correct weights | unit | `npm test -- scenario-state` | ❌ Wave 0 |
| SCENARIO-01 | Fingerprint matches for same holdings; mismatches after holdings change | unit | `npm test -- scenario-state.localStorage` | ❌ Wave 0 |
| SCENARIO-02 | Toggle-off removes weight; remaining weights renormalize to sum=1.0 | unit | `npm test -- scenario-state` | ❌ Wave 0 |
| SCENARIO-02 | Toggle-off row renders at opacity 0.5 with weight input disabled | component | `npm test -- ScenarioComposer` | ❌ Wave 0 |
| SCENARIO-03 | Bridge "Add to scenario" adds strategy at flagged holding weight | unit | `npm test -- scenario-state` | ❌ Wave 0 |
| SCENARIO-03 | BridgeDrawer confirm stage renders "Add to scenario" CTA | component | `npm test -- BridgeDrawer` | ✅ (extend) |
| SCENARIO-04 | Browse drawer search filters by alias substring | component | `npm test -- StrategyBrowseDrawer` | ❌ Wave 0 |
| SCENARIO-04 | Browse-add allocates 1/(n+1) and renormalizes existing weights | unit | `npm test -- scenario-state` | ❌ Wave 0 |
| SCENARIO-05 | computeScenario regression pins GREEN after adapter | unit | `npm test -- scenario.test` | ✅ (existing) |
| SCENARIO-05 | scenario-adapter produces correct StrategyForBuilder[] shape | unit | `npm test -- scenario-adapter` | ❌ Wave 0 |
| SCENARIO-06 | KpiStrip mode="scenario" renders delta pill with correct sign and color | component | `npm test -- KpiStrip` | ✅ (extend) |
| SCENARIO-06 | Noise floor: |Δ| < 0.01 renders neutral gray | component | `npm test -- KpiStrip` | ✅ (extend) |
| SCENARIO-07 | voluntary_remove inserts match_decisions row with kind='voluntary_remove' | route | `npm test -- scenario-commit` | ❌ Wave 0 |
| SCENARIO-07 | voluntary_add inserts bridge_outcomes row | route | `npm test -- scenario-commit` | ❌ Wave 0 |
| SCENARIO-07 | Commit route enforces allocator ownership (RLS + app-layer gate) | route | `npm test -- bridge-outcomes-rls` | ✅ (extend) |
| SCENARIO-07 | XOR relaxation migration: existing rows backfill to bridge_recommended | migration | `npm test -- match-decisions-schema` | ✅ (extend) |
| SCENARIO-08 | Draft survives tab reload; cleared on commit | unit | `npm test -- scenario-state.localStorage` | ❌ Wave 0 |
| SCENARIO-08 | Schema_version mismatch clears draft | unit | `npm test -- scenario-state.localStorage` | ❌ Wave 0 |
| SCENARIO-09 | Reset clears draft and reinitializes from holdingsSummary | unit | `npm test -- scenario-state` | ❌ Wave 0 |
| SCENARIO-09 | KpiStrip.warmup.test.tsx invariants GREEN after KpiStrip extension | regression | `npm test -- KpiStrip.warmup` | ✅ (must stay green) |

### Sampling Rate

- **Per task commit:** `npm test -- scenario-state scenario-adapter` (state + math layer; < 10s)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/app/(dashboard)/allocations/lib/scenario-state.test.ts` — covers SCENARIO-01/02/03/04/09 state invariants
- [ ] `src/app/(dashboard)/allocations/lib/scenario-state.localStorage.test.ts` — covers SCENARIO-08 localStorage + fingerprint
- [ ] `src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts` — covers SCENARIO-05 adapter shape + warm-up gate
- [ ] `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — covers SCENARIO-02 toggle/weight UI
- [ ] `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx` — covers SCENARIO-04 search + filter + mandate-fit pill
- [ ] `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx` — covers SCENARIO-07 per-diff form wiring
- [ ] `src/app/api/allocator/scenario/commit/route.test.ts` — covers SCENARIO-07 commit API route shape + RLS

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `withAuth` on all route handlers (existing project standard) |
| V3 Session Management | no | No new session state — all auth via existing Supabase JWT |
| V4 Access Control | yes | Allocator ownership gate: explicit `.eq("allocator_id", userId)` on all inserts; admin client required for match_decisions |
| V5 Input Validation | yes | zod discriminated union on commit body; holding_ref regex validated; date bounds on allocated_at |
| V6 Cryptography | no | No new crypto — exchange keys not touched by Phase 10 |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant match_decisions INSERT (supply correct allocator_id) | Tampering | admin client + explicit `.eq("allocator_id", userId)` ownership gate (mirror /api/match/decisions/holding pattern) |
| Mass-commit DoS (submit 1000 diffs in one request) | Denial of Service | `.max(50)` on diffs array in zod schema + `userActionLimiter` rate limit |
| Submitting voluntary_remove for a holding not owned by the user | Tampering | Route verifies holding ownership via `allocator_holdings` query before inserting match_decisions |
| Stale scenario draft used as proof of ownership | Elevation of Privilege | Draft is client-only; commit route re-verifies all ownership server-side against live DB state |
| Injecting arbitrary `strategy_id` in voluntary_add | Tampering | Route validates strategy exists and has `status='published'` before inserting bridge_outcomes |

---

## Sources

### Primary (HIGH confidence)

- `src/lib/scenario.ts` — full computeScenario engine, StrategyForBuilder interface, ScenarioState, ComputedMetrics (verified by direct read)
- `src/lib/queries.ts` — MyAllocationDashboardPayload type, getMyAllocationDashboard, breakdown field shape (verified by direct read)
- `supabase/migrations/072_match_decisions_original_holding_ref.sql` — XOR constraint body (verified by direct read)
- `supabase/migrations/073_compute_bridge_outcome_deltas_holding_branch.sql` — delta cron branches (verified by direct read)
- `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` — FlaggedHolding, buildHoldingRef (verified by direct read)
- `src/app/(dashboard)/allocations/lib/holdings-adapter.ts` — D-18 adapter pattern (verified by direct read)
- `src/app/(dashboard)/allocations/components/KpiStrip.tsx` — warmupCopy, cell structure (verified by direct read)
- `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` — OverlaySeries type, Props (verified by direct read)
- `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx` — deriveSnapshotDrawdowns export (verified by direct read)
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` — ScenarioStub wiring point, lines 365-377 (verified by direct read)
- `src/app/api/bridge/outcome/route.ts` — bridge outcome route schema and match_decision_id handling (verified by direct read)
- `src/app/api/match/decisions/holding/route.ts` — admin client usage for match_decisions inserts (verified by direct read)
- `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx` — existing Phase 09 component, v1 path (verified by direct read)
- `.planning/phases/10-scenario-builder-and-what-if/10-CONTEXT.md` — all decisions D-01 through D-17 (verified by direct read)
- `.planning/phases/10-scenario-builder-and-what-if/10-UI-SPEC.md` — component inventory, spacing, color tokens (verified by direct read)
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — match.decision_record audit kind (verified by direct read)
- `src/lib/audit.ts` — AuditAction enum, match.decision_record kind (verified by direct read)

### Secondary (MEDIUM confidence)

- `.planning/codebase/TESTING.md` — vi.stubGlobal localStorage pattern (verified by test file inspection)
- `.planning/codebase/CONVENTIONS.md` — import organization, file naming (verified by direct read)
- `.planning/codebase/ARCHITECTURE.md` — three-tier architecture, admin client policy (verified by direct read)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified by codebase inspection; zero new deps
- Architecture: HIGH — all integration points verified against actual file contents
- Pitfalls: HIGH — each pitfall traced to specific code (migration constraint bodies, component patterns, cron branch logic)
- Open questions: MEDIUM — identified precisely but require planner decisions

**Research date:** 2026-04-25
**Valid until:** 2026-05-25 (stable codebase — no upstream dependency churn expected)
