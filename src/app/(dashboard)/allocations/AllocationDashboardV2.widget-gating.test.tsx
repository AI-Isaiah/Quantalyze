import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * Phase 09.1 Plan 05 — V2 widget-gating invariants.
 *
 *   1. When `strategies.length === 0`, ALL 18 STRATEGY_COMPOSITE_WIDGETS are
 *      filtered out of the V2 grid (must NOT be in the DOM).
 *   2. Non-composite widgets render regardless of strategies length.
 *   3. When `strategies.length > 0`, the gate is inactive — composite
 *      widgets render alongside non-composite ones.
 *
 * The test stubs the V2 hook to inject a known config + WIDGET_COMPONENTS
 * to a deterministic stub-per-id, then asserts on `[data-widget-id]`
 * markers (the same markers WidgetGrid emits on every cell). The composite
 * id list is enumerated end-to-end so a future addition to the gate Set in
 * AllocationDashboardV2.tsx that isn't wired into the picker (or vice
 * versa) will fail this test.
 */

// Mirror of STRATEGY_COMPOSITE_WIDGETS in AllocationDashboardV2.tsx — kept
// in lockstep so adding a widget to the gate Set without updating the
// surrounding consumers fails this test. Hoisted via `vi.hoisted` so the
// `vi.mock` factories below (which Vitest hoists to the top of the file)
// can reference them without a TDZ error.
const { COMPOSITE_IDS, NON_COMPOSITE_IDS } = vi.hoisted(() => ({
  COMPOSITE_IDS: [
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
  ] as const,
  NON_COMPOSITE_IDS: [
    "kpi-strip",
    "equity-curve",
    "outcomes-timeline",
    "allocation-donut",
  ] as const,
}));

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
  const WIDGET_COMPONENTS: Record<string, React.ComponentType<unknown>> = {};
  for (const id of [...NON_COMPOSITE_IDS, ...COMPOSITE_IDS]) {
    WIDGET_COMPONENTS[id] = () => (
      <div data-testid={`widget-body-${id}`}>widget-body-{id}</div>
    );
  }
  return { WIDGET_COMPONENTS };
});

// Tiles fixture used by the V2 hook stub. Seed every composite id (so the
// gate has 18 things to filter) plus every non-composite id (so the gate
// has 4 things to keep).
const STUB_TILES_WITH_COMPOSITE = [
  ...NON_COMPOSITE_IDS.map((k) => ({ k, w: 2 as const })),
  ...COMPOSITE_IDS.map((k) => ({ k, w: 2 as const })),
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
  it("when strategies=[], all 18 composite widgets are filtered out and all 4 non-composite widgets render", async () => {
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboardV2 {...(NO_STRATEGY_PAYLOAD as any)} />,
    );

    // Wait for at least one non-composite to render (signals first paint).
    await waitFor(() => {
      expect(
        container.querySelector('[data-widget-id="kpi-strip"]'),
      ).not.toBeNull();
    });

    // Every non-composite must render.
    for (const id of NON_COMPOSITE_IDS) {
      expect(
        container.querySelector(`[data-widget-id="${id}"]`),
        `${id} (non-composite) should render in the V2 grid`,
      ).not.toBeNull();
    }

    // Every composite must be filtered.
    for (const id of COMPOSITE_IDS) {
      expect(
        container.querySelector(`[data-widget-id="${id}"]`),
        `${id} (composite) should NOT render when strategies=[]`,
      ).toBeNull();
    }
  });

  it("when strategies has rows, all 18 composite widgets DO render (gate inactive)", async () => {
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboardV2 {...(withStrategy() as any)} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector('[data-widget-id="kpi-strip"]'),
      ).not.toBeNull();
    });

    // Every composite must render when strategies has at least one row.
    for (const id of COMPOSITE_IDS) {
      expect(
        container.querySelector(`[data-widget-id="${id}"]`),
        `${id} (composite) should render when strategies has rows`,
      ).not.toBeNull();
    }

    // Sanity: non-composite widgets also render.
    for (const id of NON_COMPOSITE_IDS) {
      expect(
        container.querySelector(`[data-widget-id="${id}"]`),
      ).not.toBeNull();
    }
  });
});
