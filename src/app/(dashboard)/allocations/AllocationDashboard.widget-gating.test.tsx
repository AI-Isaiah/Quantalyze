import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { DailyPoint } from "@/lib/scenario";

/**
 * Phase 07 Plan 04 Task 3 — AllocationDashboard widget-gating tests.
 *
 * Per VOICES-ACCEPTED f2 BLOCKER:
 *   When `strategies.length === 0`, HIDE every widget whose render path
 *   consumes `strategies[].strategy_analytics.daily_returns` via
 *   buildCompositeReturns / computeScenario. These widgets render stale
 *   (or crash) against zero strategies. The authoritative list:
 *     RollingSharpe, RollingVolatility, CumulativeVsBenchmark, TailRisk,
 *     RiskDecomposition, CorrelationMatrix, CorrelationOverTime,
 *     AlphaBetaDecomposition, TrackingError, RegimeDetector,
 *     StrategyComparison, MonthlyReturns, AnnualReturns, ReturnDistribution,
 *     WinRateProfitFactor, BestWorstPeriods, PerformanceByPeriod,
 *     VarExpectedShortfall.
 *
 * Per Grok f1 + VOICES-ACCEPTED f7:
 *   EquityCurve + DrawdownChart ALWAYS render. When equityDailyPoints is
 *   non-empty, EquityCurve renders an SVG with the provided series — the
 *   dashboard MUST forward the prop through.
 *
 * This test stubs out the lazy-loaded widget registry so we can assert
 * on DOM text markers keyed to widget IDs without mounting the real
 * widget grid (which requires react-grid-layout + ResizeObserver +
 * recharts + ~15 heavy dependencies). The TileWrapper renders the
 * widget.name title from WIDGET_REGISTRY — we look for those names.
 */

// --- Required mocks --------------------------------------------------------

vi.mock("@/lib/analytics/usage-events-client", () => ({
  trackUsageEventClient: vi.fn(),
  identifyUsageUser: vi.fn(),
}));

vi.mock("./components/AlertBanner", () => ({
  AlertBanner: () => <div data-testid="alert-banner-stub" />,
}));

vi.mock("@/components/portfolio/InsightStrip", () => ({
  InsightStrip: () => <div data-testid="insight-strip-stub">InsightStrip</div>,
}));

// Stub DashboardGrid: instead of the react-grid-layout host, render each
// visible tile inline with a [data-testid="tile-<widgetId>"] marker plus
// the widget title (from WIDGET_REGISTRY). This lets the test assert on
// both (a) which widgets are in the DOM and (b) what props flowed through
// renderWidget().
vi.mock("./components/DashboardGrid", () => ({
  DashboardGrid: ({
    config,
    renderWidget,
  }: {
    config: { tiles: Array<{ i: string; widgetId: string }> };
    renderWidget: (widgetId: string) => React.ReactNode;
  }) => (
    <div data-testid="dashboard-grid-stub">
      {config.tiles.map((tile) => (
        <div key={tile.i} data-testid={`tile-${tile.widgetId}`}>
          {renderWidget(tile.widgetId)}
        </div>
      ))}
    </div>
  ),
}));

// Stub the WIDGET_COMPONENTS map: replace each lazy import with a
// deterministic marker that exposes the widgetId and records the props
// (in particular equityDailyPoints) it received. We use the default
// export pattern to match the lazy() shape.
//
// NOTE: the WIDGET_COMPONENTS map is imported from "./widgets". The
// allocations AllocationDashboard.tsx imports it via
//   import { WIDGET_COMPONENTS } from "./widgets";
// so this mock intercepts at that exact resolution.
const capturedProps: Array<Record<string, unknown>> = [];

vi.mock("./widgets", () => {
  const makeStub = (widgetId: string) =>
    function Stub(props: Record<string, unknown>) {
      capturedProps.push({ widgetId, ...props });
      return (
        <div data-testid={`widget-body-${widgetId}`}>
          widget-body-{widgetId}
          {props.equityDailyPoints !== undefined ? (
            <span data-testid="equity-points-received">
              {JSON.stringify(
                (props.equityDailyPoints as DailyPoint[]).length,
              )}
            </span>
          ) : null}
        </div>
      );
    };

  // All 39 widget ids from the registry. Each resolves to a tiny stub.
  const ids = [
    "equity-curve", "drawdown-chart", "monthly-returns", "annual-returns",
    "cumulative-vs-benchmark", "rolling-sharpe", "rolling-volatility",
    "return-distribution", "best-worst-periods", "win-rate-profit-factor",
    "correlation-matrix", "correlation-over-time", "var-expected-shortfall",
    "risk-decomposition", "tail-risk", "tracking-error",
    "allocation-donut", "allocation-over-time", "weight-drift-monitor",
    "rebalance-suggestions", "strategy-comparison",
    "attribution-waterfall", "performance-by-period",
    "alpha-beta-decomposition",
    "positions-table", "trading-activity-log", "trade-volume",
    "exposure-by-asset", "net-exposure",
    "portfolio-alerts", "exchange-status", "strategy-health",
    "data-freshness",
    "morning-briefing", "regime-detector", "concentration-risk",
    "custom-kpi-strip", "notes-widget", "quick-actions",
    "outcomes-timeline",
  ];
  const WIDGET_COMPONENTS: Record<string, React.ComponentType<Record<string, unknown>>> = {};
  for (const id of ids) WIDGET_COMPONENTS[id] = makeStub(id);
  return { WIDGET_COMPONENTS };
});

// Stub useDashboardConfig so the test doesn't touch localStorage and
// DEFAULT_LAYOUT. Include every kebab-case strategy-composite widget id
// so the gating filter has something to drop. Tile ids are unique per
// widgetId.
vi.mock("./hooks/useDashboardConfig", () => ({
  useDashboardConfig: () => ({
    config: {
      tiles: [
        // Always-rendered charts (f7 forwarding path).
        { i: "t-equity-curve", widgetId: "equity-curve", x: 0, y: 0, w: 12, h: 4 },
        { i: "t-drawdown-chart", widgetId: "drawdown-chart", x: 0, y: 4, w: 12, h: 4 },
        // All 18 strategy-composite widgets (f2 gating).
        { i: "t-rolling-sharpe", widgetId: "rolling-sharpe", x: 0, y: 0, w: 6, h: 3 },
        { i: "t-rolling-volatility", widgetId: "rolling-volatility", x: 0, y: 0, w: 6, h: 3 },
        { i: "t-cumulative-vs-benchmark", widgetId: "cumulative-vs-benchmark", x: 0, y: 0, w: 6, h: 4 },
        { i: "t-tail-risk", widgetId: "tail-risk", x: 0, y: 0, w: 4, h: 3 },
        { i: "t-risk-decomposition", widgetId: "risk-decomposition", x: 0, y: 0, w: 6, h: 3 },
        { i: "t-correlation-matrix", widgetId: "correlation-matrix", x: 0, y: 0, w: 4, h: 3 },
        { i: "t-correlation-over-time", widgetId: "correlation-over-time", x: 0, y: 0, w: 6, h: 3 },
        { i: "t-alpha-beta-decomposition", widgetId: "alpha-beta-decomposition", x: 0, y: 0, w: 6, h: 3 },
        { i: "t-tracking-error", widgetId: "tracking-error", x: 0, y: 0, w: 4, h: 3 },
        { i: "t-regime-detector", widgetId: "regime-detector", x: 0, y: 0, w: 6, h: 3 },
        { i: "t-strategy-comparison", widgetId: "strategy-comparison", x: 0, y: 0, w: 6, h: 3 },
        { i: "t-monthly-returns", widgetId: "monthly-returns", x: 0, y: 0, w: 4, h: 3 },
        { i: "t-annual-returns", widgetId: "annual-returns", x: 0, y: 0, w: 4, h: 3 },
        { i: "t-return-distribution", widgetId: "return-distribution", x: 0, y: 0, w: 4, h: 3 },
        { i: "t-win-rate-profit-factor", widgetId: "win-rate-profit-factor", x: 0, y: 0, w: 4, h: 3 },
        { i: "t-best-worst-periods", widgetId: "best-worst-periods", x: 0, y: 0, w: 4, h: 3 },
        { i: "t-performance-by-period", widgetId: "performance-by-period", x: 0, y: 0, w: 6, h: 3 },
        { i: "t-var-expected-shortfall", widgetId: "var-expected-shortfall", x: 0, y: 0, w: 4, h: 3 },
      ],
      timeframe: "YTD",
      layoutVersion: 2,
    },
    addTile: vi.fn(),
    removeTile: vi.fn(() => null),
    updateLayout: vi.fn(),
    updateTileConfig: vi.fn(),
    restoreTile: vi.fn(),
    resetToDefault: vi.fn(),
  }),
}));

vi.mock("./hooks/useTimeframe", () => ({
  useTimeframe: () => ["YTD", vi.fn()],
}));

// --- Import under test (after mocks) ---------------------------------------

import { AllocationDashboard } from "./AllocationDashboard";

// --- Fetch polyfill --------------------------------------------------------
// AllocationDashboard fires-and-forgets POST /api/usage/session-start on
// mount. jsdom doesn't have fetch; stub it to a no-op.
beforeEach(() => {
  capturedProps.length = 0;
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  ) as unknown as typeof fetch;
});

// --- Stub Phase 07 payload -------------------------------------------------

const SNAPSHOT_POINTS: DailyPoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 2, i + 1)).toISOString().slice(0, 10),
  value: 1 + i * 0.01,
}));

// Phase 07 / 07-05 — holdingsSummary must be non-empty in this test
// fixture so the 07-05 zero-holdings EmptyState early-return does NOT
// trigger. This test's whole purpose is to assert on the full render
// path (widget-gating + f7 chart forwarding); the 07-05 branch is
// exercised separately by EmptyState.test.tsx.
const MOCK_HOLDINGS = [
  {
    symbol: "BTC",
    quantity: 1.5,
    mark_price_usd: 60000,
    value_usd: 90000,
    venue: "Binance",
    holding_type: "spot" as const,
  },
];

const basePayload = {
  portfolio: null,
  analytics: null,
  apiKeys: [],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  equitySnapshots: [],
  holdingsSummary: MOCK_HOLDINGS,
  snapshotCount: 30,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: SNAPSHOT_POINTS,
  minHistoryDepthMonths: null,
  activeVenues: [],
};

// A single mock strategy for the "strategies present" test. The widget
// stubs don't read the shape, so anything that satisfies StrategyRow
// works.
function mockStrategyRow() {
  return {
    strategy_id: "mock-1",
    current_weight: 1.0,
    allocated_amount: 100000,
    alias: null,
    eligible_for_outcome: false,
    existing_outcome: null,
    strategy: {
      id: "mock-1",
      name: "Mock Strategy",
      codename: null,
      disclosure_tier: "exploratory",
      strategy_types: [],
      markets: [],
      start_date: "2026-01-01",
      strategy_analytics: {
        daily_returns: [
          { date: "2026-01-01", value: 0.01 },
          { date: "2026-01-02", value: 0.02 },
        ],
        cagr: 0.1,
        sharpe: 1.5,
        volatility: 0.2,
        max_drawdown: -0.05,
      },
    },
  };
}

const STRATEGY_COMPOSITE_IDS = [
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

// --- Tests -----------------------------------------------------------------

describe("AllocationDashboard — widget-gating (f2) + equityDailyPoints forward (f7)", () => {
  it("Test 1 (f2 gating): when strategies=[], 18 strategy-composite widgets are HIDDEN from the DOM", async () => {
    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboard {...({ ...basePayload, strategies: [] } as any)} />,
    );
    // EquityCurve + DrawdownChart are ALWAYS-RENDER (not gated).
    await waitFor(() => {
      expect(screen.getByTestId("tile-equity-curve")).toBeInTheDocument();
    });
    expect(screen.getByTestId("tile-drawdown-chart")).toBeInTheDocument();

    // Strategy-composite widgets must be absent from the DOM.
    for (const id of STRATEGY_COMPOSITE_IDS) {
      expect(
        screen.queryByTestId(`tile-${id}`),
        `tile-${id} should NOT be in the DOM when strategies=[]`,
      ).toBeNull();
    }
  });

  it("Test 2 (f2 preservation — D-05): when strategies=[<mock>], all 18 strategy-composite widgets render", async () => {
    render(
      <AllocationDashboard
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...({ ...basePayload, strategies: [mockStrategyRow()] } as any)}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("tile-equity-curve")).toBeInTheDocument();
    });
    for (const id of STRATEGY_COMPOSITE_IDS) {
      expect(
        screen.getByTestId(`tile-${id}`),
        `tile-${id} should render when strategies has rows`,
      ).toBeInTheDocument();
    }
  });

  it("Test 3 (Grok f1 e2e): EquityCurve widget receives non-empty equityDailyPoints prop with mocked snapshots", async () => {
    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboard {...({ ...basePayload, strategies: [] } as any)} />,
    );

    // Wait for the render to flush and the mock widget stub to record props.
    await waitFor(() => {
      expect(
        capturedProps.find((p) => p.widgetId === "equity-curve"),
        "equity-curve widget should have been rendered",
      ).toBeDefined();
    });

    const equityCall = capturedProps.find((p) => p.widgetId === "equity-curve");
    // Grok f1 assertion: the prop must be non-empty and match the mocked
    // points we fed through the payload.
    expect(equityCall?.equityDailyPoints).toBeDefined();
    const points = equityCall!.equityDailyPoints as DailyPoint[];
    expect(points.length).toBe(SNAPSHOT_POINTS.length);
    expect(points[0].value).toBe(SNAPSHOT_POINTS[0].value);
  });

  it("Test 4 (f7 pass-through): DrawdownChart widget also receives equityDailyPoints", async () => {
    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboard {...({ ...basePayload, strategies: [] } as any)} />,
    );
    await waitFor(() => {
      expect(
        capturedProps.find((p) => p.widgetId === "drawdown-chart"),
      ).toBeDefined();
    });
    const drawdownCall = capturedProps.find(
      (p) => p.widgetId === "drawdown-chart",
    );
    expect(drawdownCall?.equityDailyPoints).toBeDefined();
    const points = drawdownCall!.equityDailyPoints as DailyPoint[];
    expect(points.length).toBe(SNAPSHOT_POINTS.length);
  });
});
