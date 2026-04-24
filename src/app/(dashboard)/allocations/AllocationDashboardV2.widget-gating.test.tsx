import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * Phase 09.1 Plan 05 — V2 widget-gating invariants.
 *
 * Mirrors the legacy `AllocationDashboard.widget-gating.test.tsx` shape but
 * targets `AllocationDashboardV2`. The contract:
 *
 *   1. When `strategies.length === 0`, the 18 STRATEGY_COMPOSITE_WIDGETS
 *      are filtered out of the V2 grid (must NOT be in the DOM).
 *   2. Non-composite widgets render regardless of strategies length.
 *   3. When `strategies.length > 0`, the gate is inactive — composite
 *      widgets render alongside non-composite ones.
 *
 * The test stubs the V2 hook to inject a known config + WIDGET_COMPONENTS
 * to a deterministic stub-per-id, then asserts on `[data-widget-id]`
 * markers (the same markers WidgetGrid emits on every cell).
 */

// --- Required mocks --------------------------------------------------------

vi.mock("@/lib/analytics/usage-events-client", () => ({
  trackUsageEventClient: vi.fn(),
  identifyUsageUser: vi.fn(),
}));

vi.mock("./components/AlertBanner", () => ({
  AlertBanner: () => <div data-testid="alert-banner-stub" />,
}));

// Stub the WIDGET_COMPONENTS map: each id resolves to a tiny stub that
// emits a marker so we can assert on the rendered DOM.
vi.mock("./widgets", () => {
  const ids = [
    // Always-render core (non-composite registry ids).
    "kpi-strip",
    "equity-curve",
    "outcomes-timeline",
    "allocation-donut",
    // The 18 strategy-composite registry ids — at least the ones we exercise.
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
  ];
  const WIDGET_COMPONENTS: Record<string, React.ComponentType<unknown>> = {};
  for (const id of ids) {
    WIDGET_COMPONENTS[id] = () => (
      <div data-testid={`widget-body-${id}`}>widget-body-{id}</div>
    );
  }
  return { WIDGET_COMPONENTS };
});

// Tiles fixture used by the V2 hook stub. We seed BOTH composite and
// non-composite registry ids so the gate has something to filter (and
// something to keep).
const STUB_TILES_WITH_COMPOSITE = [
  { k: "kpi-strip", w: 4 as const },
  { k: "equity-curve", w: 4 as const },
  { k: "correlation-matrix", w: 2 as const }, // composite — filtered when no strategies
  { k: "rolling-sharpe", w: 2 as const }, // composite — filtered when no strategies
  { k: "allocation-donut", w: 1 as const }, // non-composite — always renders
];

vi.mock("./hooks/useDashboardConfig", () => ({
  useDashboardConfigV2: () => ({
    config: {
      tiles: STUB_TILES_WITH_COMPOSITE,
      timeframe: "YTD",
      layoutVersion: 4,
    },
    addWidget: vi.fn(),
    removeWidget: vi.fn(),
    resizeWidget: vi.fn(),
    moveWidget: vi.fn(),
    setTimeframe: vi.fn(),
    resetToDefaults: vi.fn(),
  }),
  // The legacy hook export must stay defined or other callers break in
  // the same module graph; provide a no-op so this file compiles.
  useDashboardConfig: () => ({
    config: { tiles: [], timeframe: "YTD", layoutVersion: 3 },
    addTile: vi.fn(),
    removeTile: vi.fn(),
    updateLayout: vi.fn(),
    updateTileConfig: vi.fn(),
    restoreTile: vi.fn(),
    resetToDefault: vi.fn(),
  }),
}));

// --- Import under test (after mocks) ---------------------------------------

import { AllocationDashboardV2 } from "./AllocationDashboardV2";

// --- Fetch + observer polyfills --------------------------------------------

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  ) as unknown as typeof fetch;

  // jsdom doesn't have IntersectionObserver / MutationObserver in older
  // versions; stub minimal implementations so the V2 hooks-of-effect path
  // runs to completion without throwing. The test doesn't assert on
  // analytics emission — only on the rendered DOM.
  if (typeof globalThis.IntersectionObserver === "undefined") {
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

// Holdings present, no strategies — exercises the f2 gate (must filter).
const NO_STRATEGY_PAYLOAD = {
  portfolio: null,
  analytics: null,
  apiKeys: [],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  equitySnapshots: [],
  holdingsSummary: [
    {
      symbol: "BTC",
      quantity: 1.5,
      mark_price_usd: 60000,
      value_usd: 90000,
      venue: "Binance",
      holding_type: "spot" as const,
    },
  ],
  snapshotCount: 30,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: [],
  minHistoryDepthMonths: null,
  activeVenues: [],
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  strategies: [] as unknown[],
};

// One strategy — gate inactive.
function withStrategy() {
  return {
    ...NO_STRATEGY_PAYLOAD,
    strategies: [
      {
        strategy_id: "mock-1",
        current_weight: 1,
        allocated_amount: 100000,
        alias: null,
        eligible_for_outcome: false,
        existing_outcome: null,
        strategy: {
          id: "mock-1",
          name: "Mock",
          codename: null,
          disclosure_tier: "exploratory",
          strategy_types: [],
          markets: [],
          start_date: "2026-01-01",
          strategy_analytics: {
            daily_returns: [
              { date: "2026-01-01", value: 0.01 },
            ],
            cagr: 0.1,
            sharpe: 1.5,
            volatility: 0.2,
            max_drawdown: -0.05,
          },
        },
      },
    ],
  };
}

// --- Tests -----------------------------------------------------------------

describe("AllocationDashboardV2 — widget-gating (V2 f2)", () => {
  it("when strategies=[], composite widgets are filtered out of the V2 grid", async () => {
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboardV2 {...(NO_STRATEGY_PAYLOAD as any)} />,
    );

    // Non-composite widgets render via their data-widget-id markers.
    await waitFor(() => {
      expect(
        container.querySelector('[data-widget-id="kpi-strip"]'),
        "kpi-strip should render in the V2 grid",
      ).not.toBeNull();
    });
    expect(
      container.querySelector('[data-widget-id="equity-curve"]'),
      "equity-curve should render in the V2 grid",
    ).not.toBeNull();
    expect(
      container.querySelector('[data-widget-id="allocation-donut"]'),
      "allocation-donut (non-composite) should render in the V2 grid",
    ).not.toBeNull();

    // Composite widgets must be filtered out of the DOM (gate active).
    expect(
      container.querySelector('[data-widget-id="correlation-matrix"]'),
      "correlation-matrix (composite) should NOT render when strategies=[]",
    ).toBeNull();
    expect(
      container.querySelector('[data-widget-id="rolling-sharpe"]'),
      "rolling-sharpe (composite) should NOT render when strategies=[]",
    ).toBeNull();
  });

  it("when strategies has rows, composite widgets DO render (gate inactive)", async () => {
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboardV2 {...(withStrategy() as any)} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector('[data-widget-id="correlation-matrix"]'),
        "correlation-matrix should render when strategies has rows",
      ).not.toBeNull();
    });
    expect(
      container.querySelector('[data-widget-id="rolling-sharpe"]'),
      "rolling-sharpe should render when strategies has rows",
    ).not.toBeNull();

    // Sanity: non-composite widgets also render.
    expect(
      container.querySelector('[data-widget-id="kpi-strip"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-widget-id="equity-curve"]'),
    ).not.toBeNull();
  });
});
