---
phase: 14a
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/queries.ts
  - src/lib/strategy-ui-v2-flag.ts
  - src/lib/strategy-ui-v2-flag.test.ts
autonomous: true
requirements: [KPI-01, KPI-02, KPI-03, KPI-04, KPI-05, KPI-22, KPI-23a]
must_haves:
  truths:
    - "getStrategyDetailV2(strategyId) reads only `published` strategies (matches v1 visibility gate)"
    - "getStrategyDetailV2 returns null for not-found / unpublished strategies"
    - "getStrategyDetailV2 distinguishes 'no analytics row' from 'analytics row exists but key is null' — does NOT fall back to EMPTY_ANALYTICS (per RESEARCH Pitfall 8)"
    - "Returned shape exposes panel1, panel2Headline, panel2Equity, panel3, lazyKeys, history_days fields per UI-SPEC §6"
    - "isStrategyUiV2Enabled() returns false on the server (typeof window === 'undefined')"
    - "isStrategyUiV2Enabled honors URL override `?strategy_v2=on|true|v2|off|false` ahead of localStorage"
    - "isStrategyUiV2Enabled localStorage key = 'strategy.ui_v2'; URL param = 'strategy_v2'"
    - "Phase 14a default = OFF (no localStorage / URL → returns false)"
  artifacts:
    - path: "src/lib/queries.ts"
      provides: "Extended with getStrategyDetailV2 and StrategyV2Detail interface; v1 functions untouched"
      contains: "export async function getStrategyDetailV2"
    - path: "src/lib/strategy-ui-v2-flag.ts"
      provides: "URL > localStorage > SSR-default-OFF flag reader for strategy.ui_v2"
      exports: ["isStrategyUiV2Enabled", "STRATEGY_UI_V2_STORAGE_KEY", "STRATEGY_UI_V2_URL_OVERRIDE"]
    - path: "src/lib/strategy-ui-v2-flag.test.ts"
      provides: "Vitest unit tests covering URL override variants + localStorage + SSR default"
  key_links:
    - from: "src/lib/queries.ts:getStrategyDetailV2"
      to: "supabase.from('strategies').select(...).eq('status', 'published')"
      via: "Supabase server client"
      pattern: "\\.eq\\(\"status\", \"published\"\\)"
    - from: "src/lib/strategy-ui-v2-flag.ts"
      to: "src/lib/widget-state-flag.ts (canonical reference pattern)"
      via: "structural mirror — three-tier precedence"
      pattern: "URLSearchParams|localStorage"
---

<objective>
Land the data layer for Phase 14a in parallel with the chart-tokens plan: ship `getStrategyDetailV2(strategyId)` in `src/lib/queries.ts` (path-extraction over `metrics_json` → returns the panel-1-3 eager response shape per UI-SPEC §6) and ship the `strategy.ui_v2` localStorage + URL flag reader at `src/lib/strategy-ui-v2-flag.ts`. Both surfaces are independent of Plan 14A-01 (chart tokens) and can run concurrently.

Purpose: Provide the deterministic data input that Plan 14A-03's components consume (no separate sibling-table read needed for panels 1–3 per RESEARCH §A1) and provide the SSR-safe flag reader that Plan 14A-04's route + Plan 14A-05's tests target. v1's `getStrategyDetail` is left untouched — minimal blast radius.

Output:
1. New `getStrategyDetailV2` async function (~80 LOC) + `StrategyV2Detail` interface in `src/lib/queries.ts` (extension only, v1 surface preserved).
2. New `src/lib/strategy-ui-v2-flag.ts` (~50 LOC, mirrors `widget-state-flag.ts` exactly with renamed constants + Phase-14a-default-OFF semantics).
3. New `src/lib/strategy-ui-v2-flag.test.ts` covering all 3 tiers (URL override, localStorage, SSR default).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-CONTEXT.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md
@AGENTS.md
@src/lib/queries.ts
@src/lib/widget-state-flag.ts
@src/lib/types.ts

<interfaces>
<!-- Verified existing exports from src/lib/queries.ts (lines 214-372): -->

```ts
// Existing v1 surfaces — DO NOT MODIFY:
export async function getPublicStrategyDetail(strategyId: string): Promise<{
  strategy: Strategy;
  analytics: ReturnType<typeof extractAnalytics>;
  manager: ManagerIdentity | null;
  disclosureTier: DisclosureTier;
} | null>;

export async function getStrategyDetail(strategyId: string): Promise<{
  strategy: Strategy;
  analytics: StrategyAnalytics;
  manager: ManagerIdentity | null;
  disclosureTier: DisclosureTier;
} | null>;

// Phase 12 consumer (already shipped, NOT invoked by 14a — present in queries.ts):
export type LazyMetricsPanelId =
  | "overview" | "equity" | "drawdown" | "returns_dist" | "rolling" | "trades" | "exposure";
export async function fetchStrategyLazyMetrics(strategyId: string, panelId: LazyMetricsPanelId): Promise<LazyMetricsPayload>;
```

<!-- Existing imports at top of queries.ts (line 1-31): -->
```ts
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { extractAnalytics, EMPTY_ANALYTICS } from "./utils";  // EMPTY_ANALYTICS: do NOT use as fallback per Pitfall 8
import type { Strategy, ManagerIdentity, DisclosureTier, StrategyAnalytics } from ...;
```

<!-- Strategy and StrategyAnalytics shapes (verified from src/lib/types.ts:35-117): -->
```ts
// Strategy fields used by Panel 1 Overview (KPI-02):
//   strategy.supported_exchanges: string[]
//   strategy.strategy_types: string[]
//   strategy.subtypes: string[]
//   strategy.markets: string[]
//   strategy.leverage_range: string | null
//   strategy.avg_daily_turnover: number | null
//   strategy.start_date: string | null
//   strategy.name: string

// StrategyAnalytics scalars used by Panel 2 KPI strip (KPI-03):
//   cumulative_return | cagr | sharpe | sortino | max_drawdown | volatility (all number | null)
//   returns_series: { date: string; value: number }[] | null  ← Panel 2 Equity (or use metrics_json.equity_series_1y)
//   drawdown_series: { date: string; value: number }[] | null ← Panel 3 Drawdown
//   metrics_json: Record<string, unknown> | null              ← contains drawdown_episodes, equity_series_1y, btc_benchmark_returns
//   computation_status: "pending" | "computing" | "complete" | "failed"
```

<!-- Canonical flag reader pattern (verified src/lib/widget-state-flag.ts:1-65): -->
```ts
// Three-tier precedence: URL > localStorage > SSR-safe default OFF
// URL overrides:
//   "v2" | "true" | "on" → ON
//   "off" | "false" → OFF
//   anything else → fall through to localStorage
// localStorage: raw === "true" → ON; otherwise OFF
// SSR (typeof window === "undefined") → return safe default (OFF in 14a)
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add getStrategyDetailV2 to src/lib/queries.ts</name>
  <files>src/lib/queries.ts</files>
  <read_first>
    - src/lib/queries.ts (full file — MUST read to find an idiomatic insertion point AFTER `getStrategyDetail` at line 275-300 and BEFORE the `LazyMetricsPanelId` type at line 318; also confirms existing imports of `Strategy`, `StrategyAnalytics`, `extractAnalytics`, `EMPTY_ANALYTICS`, `createClient`)
    - src/lib/types.ts lines 35-117 (Strategy + StrategyAnalytics shapes — confirms exact field names for Panel 1 cells and Panel 2 KPI strip; do NOT invent field names, use only what's declared)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md Pattern 7 + Pitfall 8 (Pitfall 8 is critical: do NOT fall back to EMPTY_ANALYTICS)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md §6 "Backend lib" + §4 partial-data thresholds (banners trigger when relevant keys are null and history_days &lt; threshold)
    - supabase/migrations/087_strategy_analytics_series.sql (confirm `equity_series_1y` and `drawdown_episodes` and `btc_benchmark_returns` are inside `metrics_json` per H-D, NOT in the sibling table for above-the-fold reads)
  </read_first>
  <behavior>
    - Test 1: `getStrategyDetailV2("nonexistent-uuid")` returns `null` (no error thrown)
    - Test 2: `getStrategyDetailV2(strategyId)` for a strategy where `status !== 'published'` returns `null` (visibility gate)
    - Test 3: `getStrategyDetailV2(strategyId)` for a published strategy returns `{ strategy, panel1, panel2Headline, panel2Equity, panel3, lazyKeys, history_days }` shape
    - Test 4: When `strategy_analytics` is missing entirely, returned `panel2Headline.cumulative_return` is `null` (NOT zero, NOT EMPTY_ANALYTICS pollution) — Pitfall 8 contract
    - Test 5: When `analytics.computation_status !== 'complete'`, all derived scalars are surfaced as `null` (so Panel 2 KPI strip renders the partial-data banner; UI-SPEC §4)
    - Test 6: `lazyKeys` is always exactly the 4-element array `["panel4", "panel5", "panel6", "panel7"]` in 14a (placeholders for all 4 lazy panels — Phase 14b consumes and refines)
    - Test 7: `history_days` reflects either `analytics.metrics_json.history_days` (if present) or is computed from `returns_series.length` (fallback) or `0` (no series available)
  </behavior>
  <action>
1. Read `src/lib/queries.ts` in full. Confirm the imports of `Strategy`, `StrategyAnalytics`, `extractAnalytics`, `createClient`, and the file's existing patterns.

2. Insert the new TypeScript interface `StrategyV2Detail` and the `getStrategyDetailV2` async function AFTER the existing `getStrategyDetail` function (which ends at line 300) and BEFORE the existing `LazyMetricsPanelId` type union comment block (line 302). Concrete shape:

```ts
/**
 * Phase 14a / METRICS-15 path-extraction half (consumer half shipped Plan 12-08
 * as `fetchStrategyLazyMetrics`). Reads scalars + above-the-fold series for the
 * `/strategy/[id]/v2` 7-panel UI (Panels 1–3 eager). Heavy series for Panels
 * 4–7 are deferred to Phase 14b, which calls `fetchStrategyLazyMetrics` from
 * inside the IntersectionObserver-mounted lazy panels.
 *
 * Visibility gate: same as `getPublicStrategyDetail` — `status='published'`
 * predicate. Private/unpublished strategies return `null` (rendered as 404 by
 * the page-level `notFound()` call).
 *
 * Pitfall 8 contract: does NOT fall back to EMPTY_ANALYTICS when no analytics
 * row exists. Returns `null` for missing scalars so per-panel partial-data
 * banners can distinguish "no data" from "0% return".
 */
export interface StrategyV2Detail {
  strategy: Strategy;
  panel1: {
    supported_exchanges: string[];
    strategy_types: string[];
    subtypes: string[];
    markets: string[];
    leverage_range: string | null;
    avg_daily_turnover: number | null;
  };
  panel2Headline: {
    cumulative_return: number | null;
    cagr: number | null;
    sharpe: number | null;
    sortino: number | null;
    max_drawdown: number | null;
    volatility: number | null;
  };
  panel2Equity: {
    series: { date: string; value: number }[] | null;
    btc_overlay: { date: string; value: number }[] | null;
  };
  panel3: {
    drawdown_series: { date: string; value: number }[] | null;
    drawdown_episodes: unknown[] | null;
  };
  lazyKeys: ("panel4" | "panel5" | "panel6" | "panel7")[];
  history_days: number;
}

export async function getStrategyDetailV2(
  strategyId: string,
): Promise<StrategyV2Detail | null> {
  const supabase = await createClient();
  const { data: strategy, error } = await supabase
    .from("strategies")
    .select("*, strategy_analytics (*)")
    .eq("id", strategyId)
    .eq("status", "published")
    .single();

  if (error || !strategy) return null;

  // Pitfall 8: do NOT fall back to EMPTY_ANALYTICS. Read the row directly so
  // missing keys remain `null` and per-panel banners trigger correctly.
  const analyticsRaw = (strategy as Record<string, unknown>).strategy_analytics;
  const a = extractAnalytics(analyticsRaw);
  const isComplete = a?.computation_status === "complete";
  const metricsJson = (a?.metrics_json ?? {}) as Record<string, unknown>;

  const panel1 = {
    supported_exchanges: (strategy as Strategy).supported_exchanges ?? [],
    strategy_types: (strategy as Strategy).strategy_types ?? [],
    subtypes: (strategy as Strategy).subtypes ?? [],
    markets: (strategy as Strategy).markets ?? [],
    leverage_range: (strategy as Strategy).leverage_range ?? null,
    avg_daily_turnover: (strategy as Strategy).avg_daily_turnover ?? null,
  };

  const panel2Headline = {
    cumulative_return: isComplete ? (a?.cumulative_return ?? null) : null,
    cagr: isComplete ? (a?.cagr ?? null) : null,
    sharpe: isComplete ? (a?.sharpe ?? null) : null,
    sortino: isComplete ? (a?.sortino ?? null) : null,
    max_drawdown: isComplete ? (a?.max_drawdown ?? null) : null,
    volatility: isComplete ? (a?.volatility ?? null) : null,
  };

  const equitySeries = isComplete
    ? ((metricsJson["equity_series_1y"] as { date: string; value: number }[] | undefined)
        ?? a?.returns_series
        ?? null)
    : null;
  const btcOverlay = isComplete
    ? ((metricsJson["btc_benchmark_returns"] as { date: string; value: number }[] | undefined) ?? null)
    : null;

  const panel2Equity = {
    series: equitySeries,
    btc_overlay: btcOverlay,
  };

  const panel3 = {
    drawdown_series: isComplete ? (a?.drawdown_series ?? null) : null,
    drawdown_episodes: isComplete
      ? ((metricsJson["drawdown_episodes"] as unknown[] | undefined) ?? null)
      : null,
  };

  // history_days: prefer metrics_json.history_days when populated; otherwise
  // derive from returns_series length; default 0.
  const historyDaysFromJson = typeof metricsJson["history_days"] === "number"
    ? (metricsJson["history_days"] as number)
    : null;
  const historyDaysFromSeries = a?.returns_series?.length ?? 0;
  const history_days = historyDaysFromJson ?? historyDaysFromSeries;

  return {
    strategy: strategy as Strategy,
    panel1,
    panel2Headline,
    panel2Equity,
    panel3,
    lazyKeys: ["panel4", "panel5", "panel6", "panel7"],
    history_days,
  };
}
```

3. Do NOT modify `getStrategyDetail`, `getPublicStrategyDetail`, `getFactsheetDetail`, `fetchStrategyLazyMetrics`, or any other existing export.

4. Confirm `npm run typecheck` exits 0 (no new errors introduced).
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -i "queries.ts" || echo "TYPECHECK_OK"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "export async function getStrategyDetailV2" src/lib/queries.ts` returns exactly 1 match
    - `grep -n "export interface StrategyV2Detail" src/lib/queries.ts` returns exactly 1 match
    - `grep -n "lazyKeys: \\[\"panel4\", \"panel5\", \"panel6\", \"panel7\"\\]" src/lib/queries.ts` returns exactly 1 match
    - `grep -n "EMPTY_ANALYTICS" src/lib/queries.ts | wc -l` ≤ existing-pre-edit count + 0 (function does NOT introduce new EMPTY_ANALYTICS reference; Pitfall 8) — i.e. count must equal the pre-edit count of 3 (lines 6, 165, 296)
    - `grep -n "\\.eq(\"status\", \"published\")" src/lib/queries.ts` returns at least 2 matches (existing `getPublicStrategyDetail` + new `getStrategyDetailV2`)
    - `grep -n "computation_status === \"complete\"" src/lib/queries.ts` returns at least 1 match (the new function uses this gate)
    - `grep -n "export async function getStrategyDetail\\b" src/lib/queries.ts` returns exactly 1 match (v1 unchanged — no accidental duplicate)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>getStrategyDetailV2 + StrategyV2Detail exported from queries.ts; typecheck clean; v1 surfaces unchanged; Pitfall 8 contract honored (no EMPTY_ANALYTICS fallback in new function).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create strategy-ui-v2-flag.ts + co-located test</name>
  <files>src/lib/strategy-ui-v2-flag.ts, src/lib/strategy-ui-v2-flag.test.ts</files>
  <read_first>
    - src/lib/widget-state-flag.ts (full file — the canonical pattern to mirror; same 3-tier precedence, same SSR-safe-default semantics, same try/catch around localStorage)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md §5.1 (URL parameter name = `strategy_v2`; localStorage key = `strategy.ui_v2`; default OFF in 14a)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-CONTEXT.md decisions section "Route topology &amp; flag default (KPI-01)"
    - vitest.config.ts (Wave 1 verification — confirm Vitest picks up `src/**/*.test.ts` via existing `include` glob)
  </read_first>
  <behavior>
    - Test 1: `isStrategyUiV2Enabled()` returns `false` when `typeof window === 'undefined'` (SSR safety) — simulate by setting `delete (globalThis as unknown as { window?: unknown }).window` in the test
    - Test 2: URL `?strategy_v2=on` → returns `true`
    - Test 3: URL `?strategy_v2=true` → returns `true`
    - Test 4: URL `?strategy_v2=v2` → returns `true`
    - Test 5: URL `?strategy_v2=off` → returns `false` (even if localStorage has `"true"`)
    - Test 6: URL `?strategy_v2=false` → returns `false`
    - Test 7: URL `?strategy_v2=garbage` (unrecognized) → falls through to localStorage; if localStorage has `"true"` returns `true`; else `false`
    - Test 8: localStorage `"strategy.ui_v2" = "true"` (no URL param) → returns `true`
    - Test 9: localStorage missing AND URL missing → returns `false` (Phase 14a default)
    - Test 10: STORAGE_KEY constant equals `"strategy.ui_v2"`; URL_OVERRIDE constant equals `"strategy_v2"`
  </behavior>
  <action>
1. Create `src/lib/strategy-ui-v2-flag.ts` mirroring `src/lib/widget-state-flag.ts` exactly with the renamed constants. The full file content:

```ts
/**
 * Phase 14a / KPI-01 — Feature-flag reader for the `/strategy/[id]/v2`
 * Single-Strategy v2 surface.
 *
 * Phase 14a default = OFF. Flips to ON when Phase 14b lands the lazy bodies
 * and full coverage. Mirrors the Phase 09.1/10-06b `allocations.ui_v2`
 * precedent (`AllocationsTabs.tsx`) and the Phase 11 `widget_state_v2` reader
 * (`src/lib/widget-state-flag.ts`).
 *
 * Default OFF. Flip via:
 *   - localStorage.setItem("strategy.ui_v2", "true")  → persistent ON
 *   - URL ?strategy_v2=on / ?strategy_v2=v2 / ?strategy_v2=true → ON for this load
 *   - URL ?strategy_v2=off / ?strategy_v2=false                  → OFF for this load
 *
 * SSR safety: returns `false` (the safe default) when `typeof window ===
 * "undefined"`, avoiding hydration mismatch between server-rendered HTML and
 * client mount. The two-pass mount pattern (`useState(SSR_DEFAULT)` + `useEffect(() =>
 * isStrategyUiV2Enabled() && setState(true), [])`) is the canonical consumer
 * shape; see `AllocationsTabs.tsx:225-243` and `RESEARCH.md` Pattern 2.
 *
 * 14a usage: this reader exists; the redirect consumer (v1 → v2 auto-flip)
 * lands in 14b. In 14a the flag never causes a redirect.
 */

export const STRATEGY_UI_V2_STORAGE_KEY = "strategy.ui_v2";
export const STRATEGY_UI_V2_URL_OVERRIDE = "strategy_v2";

export interface StrategyUiV2Options {
  /**
   * URL search string (with or without leading '?'). Pass an explicit value
   * for unit-testability; the production caller can omit this and the
   * function falls through to `window.location.search`.
   */
  search?: string;
}

export function isStrategyUiV2Enabled(opts?: StrategyUiV2Options): boolean {
  // SSR-safe default OFF in Phase 14a. Flips to ON in Phase 14b.
  if (typeof window === "undefined") return false;

  // URL override wins (highest precedence). The `strategy_v2` param accepts
  // v2/true/on for ON and off/false for OFF; any other value falls through
  // to localStorage so a malformed override doesn't silently lock the flag.
  const search = opts?.search ?? window.location.search;
  const params = new URLSearchParams(search);
  const override = params.get(STRATEGY_UI_V2_URL_OVERRIDE);
  if (override === "v2" || override === "true" || override === "on") {
    return true;
  }
  if (override === "off" || override === "false") {
    return false;
  }

  // Fall through to localStorage (default OFF — Phase 14a contract).
  try {
    const raw = window.localStorage.getItem(STRATEGY_UI_V2_STORAGE_KEY);
    if (raw === "true") return true;
    return false;
  } catch {
    return false;
  }
}
```

2. Create `src/lib/strategy-ui-v2-flag.test.ts` with the 10 tests below. The test file MUST run under Vitest's existing `src/**/*.test.{ts,tsx}` include glob (no config changes — Plan 14A-05 will extend the include for the `tests/` top-level dirs separately):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isStrategyUiV2Enabled,
  STRATEGY_UI_V2_STORAGE_KEY,
  STRATEGY_UI_V2_URL_OVERRIDE,
} from "./strategy-ui-v2-flag";

describe("strategy-ui-v2-flag", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
  });

  it("constants match Phase 14a CONTEXT.md", () => {
    expect(STRATEGY_UI_V2_STORAGE_KEY).toBe("strategy.ui_v2");
    expect(STRATEGY_UI_V2_URL_OVERRIDE).toBe("strategy_v2");
  });

  it("returns false on the server (typeof window === undefined)", () => {
    // Simulate SSR by stubbing globalThis.window to undefined.
    const originalWindow = globalThis.window;
    // @ts-expect-error simulate SSR
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(isStrategyUiV2Enabled({ search: "" })).toBe(false);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("URL ?strategy_v2=on returns true", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=on" })).toBe(true);
  });

  it("URL ?strategy_v2=true returns true", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=true" })).toBe(true);
  });

  it("URL ?strategy_v2=v2 returns true", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=v2" })).toBe(true);
  });

  it("URL ?strategy_v2=off returns false even if localStorage has \"true\"", () => {
    window.localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "true");
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=off" })).toBe(false);
  });

  it("URL ?strategy_v2=false returns false", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=false" })).toBe(false);
  });

  it("URL ?strategy_v2=garbage falls through to localStorage", () => {
    window.localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "true");
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=garbage" })).toBe(true);
  });

  it("localStorage \"true\" with no URL returns true", () => {
    window.localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "true");
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(true);
  });

  it("Phase 14a default (no URL, no localStorage) returns false", () => {
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(false);
  });
});
```

3. Run `npm test -- src/lib/strategy-ui-v2-flag.test.ts` and confirm 10/10 tests pass GREEN.
  </action>
  <verify>
    <automated>npm test -- src/lib/strategy-ui-v2-flag.test.ts --run 2>&amp;1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - File `src/lib/strategy-ui-v2-flag.ts` exists
    - File `src/lib/strategy-ui-v2-flag.test.ts` exists
    - `grep -n "export const STRATEGY_UI_V2_STORAGE_KEY = \"strategy.ui_v2\"" src/lib/strategy-ui-v2-flag.ts` returns 1 match
    - `grep -n "export const STRATEGY_UI_V2_URL_OVERRIDE = \"strategy_v2\"" src/lib/strategy-ui-v2-flag.ts` returns 1 match
    - `grep -n "export function isStrategyUiV2Enabled" src/lib/strategy-ui-v2-flag.ts` returns 1 match
    - `grep -n "if (typeof window === \"undefined\") return false" src/lib/strategy-ui-v2-flag.ts` returns 1 match
    - `grep -nE "if \\(override === \"v2\" \\|\\| override === \"true\" \\|\\| override === \"on\"\\)" src/lib/strategy-ui-v2-flag.ts` returns 1 match
    - `npm test -- src/lib/strategy-ui-v2-flag.test.ts --run` exits 0 with 10 tests passing
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Flag reader file + test file exist; 10 tests pass; SSR returns false; URL → localStorage → default precedence honored; Phase 14a default OFF.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → server (Next.js page handler) | `params.id` (UUID) flows from URL to Supabase query — parameter-binding by `.eq("id", strategyId)` |
| URL → flag reader | `?strategy_v2=` query param flows into `isStrategyUiV2Enabled` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14a-02-01 | T (Tampering) | URL `?strategy_v2=` parameter | mitigate | Whitelist exact values `on/true/v2/off/false`; anything else falls through to localStorage (no failure mode lets a malformed value silently lock state). Mirrors `widget-state-flag.ts:48-54`. |
| T-14a-02-02 | I (Information disclosure) | `getStrategyDetailV2` visibility gate | mitigate | `.eq("status", "published")` predicate matches v1 `getPublicStrategyDetail` — non-published strategies return `null` → page-level `notFound()` (404). No information leaked beyond v1 behavior. |
| T-14a-02-03 | I | Hydration mismatch leaking flag state via SSR/CSR difference | mitigate | SSR returns the safe default (`false`); the two-pass mount pattern in consumers (Plan 14A-04) reads the actual flag only client-side. Pattern 2 in RESEARCH.md. |
| T-14a-02-04 | I | EMPTY_ANALYTICS leak through `getStrategyDetailV2` | accept (mitigated by design) | New function explicitly does NOT fall back to EMPTY_ANALYTICS (Pitfall 8). Missing keys return `null` so per-panel banners distinguish "no data" from "0% return". |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `npm test -- src/lib/strategy-ui-v2-flag.test.ts --run` exits 0 with all 10 tests passing
- `grep -c "export async function getStrategyDetailV2" src/lib/queries.ts` returns 1
- `grep -c "export interface StrategyV2Detail" src/lib/queries.ts` returns 1
- `grep -c "STRATEGY_UI_V2_STORAGE_KEY" src/lib/strategy-ui-v2-flag.ts` returns at least 2 (declaration + use inside function)
</verification>

<success_criteria>
1. `getStrategyDetailV2` returns the documented `StrategyV2Detail` shape and honors the `published` visibility gate.
2. Pitfall 8 contract honored — no EMPTY_ANALYTICS fallback inside the new function.
3. `isStrategyUiV2Enabled` returns false on the server, honors URL override before localStorage, defaults OFF in 14a.
4. 10/10 unit tests pass.
5. `npx tsc --noEmit` and `npm run build` both exit 0.
</success_criteria>

<output>
After completion, create `.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-02-SUMMARY.md` describing:
- Final shape of `StrategyV2Detail` (any deviations from the plan)
- Confirmation that v1 `getStrategyDetail` was untouched
- Test pass count for `strategy-ui-v2-flag.test.ts`
- tsc + build status
</output>
