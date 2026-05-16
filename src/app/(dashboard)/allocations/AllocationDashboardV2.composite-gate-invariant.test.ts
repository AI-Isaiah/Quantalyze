import { describe, it, expect } from "vitest";
import { DEFAULT_LAYOUT } from "./lib/dashboard-defaults";
import {
  resolveWidgetId,
  DESIGNER_KEY_TO_WIDGET_ID,
} from "./lib/widget-registry";

/**
 * audit-2026-05-07 H-0052 c9 code-reviewer — V2 STRATEGY_COMPOSITE_WIDGETS
 * gate compares registry ids against the in-component Set. DEFAULT_LAYOUT
 * ships designer short keys (`bridge`,`kpi`,`equity`,`holdings`,`allocation`,
 * `mandate`,`outcomes`) that resolveWidgetId normalises to full ids. The
 * current gate is safe today because none of the 7 default tiles map to a
 * composite id — but the brittleness is structural: any future designer
 * short-key whose mapping target lands inside the composite Set would
 * silently disappear from the V2 dashboard on first paint for every new
 * allocator. Lock the invariant in a unit test so we fail-fast in CI
 * instead of shipping the regression behind a feature flag.
 *
 * Cross-refs: red-team H-0053 (first-time-user empty-dashboard chain) and
 * silent-failure-hunter #9.
 */

// Kept in lockstep with the in-component Set in AllocationDashboardV2.tsx
// (lines 56-75). Updating one without updating the other will fail this
// test or the widget-gating test (intentionally redundant guard).
const STRATEGY_COMPOSITE_WIDGETS: ReadonlySet<string> = new Set([
  "rolling-sharpe",
  "rolling-volatility",
  "cumulative-vs-benchmark",
  "tail-risk",
  "risk-decomposition",
  "correlation-matrix",
  "correlation-over-time",
  "alpha-beta-decomposition",
  "tracking-error",
  "regime-detector",
  "strategy-comparison",
  "monthly-returns",
  "annual-returns",
  "return-distribution",
  "win-rate-profit-factor",
  "best-worst-periods",
  "performance-by-period",
  "var-expected-shortfall",
]);

describe("AllocationDashboardV2 — composite-gate invariant (H-0052)", () => {
  it("DEFAULT_LAYOUT post-normalization never intersects STRATEGY_COMPOSITE_WIDGETS", () => {
    const collisions = DEFAULT_LAYOUT
      .map((t) => ({ short: t.k, full: resolveWidgetId(t.k) }))
      .filter((m) => STRATEGY_COMPOSITE_WIDGETS.has(m.full));
    expect(
      collisions,
      `DEFAULT_LAYOUT key(s) resolved to a strategy-composite registry id ` +
        `— these tiles would silently dis-render for every new allocator ` +
        `via the f2 gate. Either rename the registry id or remove the ` +
        `default tile. Collisions: ${JSON.stringify(collisions)}`,
    ).toEqual([]);
  });

  it("no DESIGNER_KEY_TO_WIDGET_ID short key maps to a strategy-composite id (defensive)", () => {
    const collisions = Object.entries(DESIGNER_KEY_TO_WIDGET_ID).filter(
      ([, full]) => STRATEGY_COMPOSITE_WIDGETS.has(full),
    );
    // The current mapping is "outcomes" → "outcomes-timeline", "kpi" →
    // "kpi-strip" etc., none of which are in the composite set. If a future
    // designer short key whose mapping target lands inside the composite
    // set gets added, this fails — flagging the structural regression at
    // build time instead of through a silent dis-render.
    expect(
      collisions,
      `DESIGNER_KEY_TO_WIDGET_ID entry resolves to a strategy-composite ` +
        `id; adding that short key to DEFAULT_LAYOUT (or persisting it via ` +
        `the picker) would land on the f2 gate and dis-render silently. ` +
        `Collisions: ${JSON.stringify(collisions)}`,
    ).toEqual([]);
  });
});
