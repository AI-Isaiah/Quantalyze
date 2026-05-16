import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * audit-2026-05-07 H-1194 + H-1195 (pr-test-analyzer c10) — direct test
 * coverage for the two PR3/HANDOFF-G9 user-facing branches in
 * AllocationDashboardV2 that previously had ZERO assertions:
 *
 *   1. The "Connect a strategy to unlock N widgets" empty-grid callout.
 *      H-1194 / H-1196 — both cite the same gap: filteredStrategyTileCount
 *      computes the count, the JSX renders `data-testid="empty-grid-callout"`,
 *      and the Link goes to `/discovery`, but no test asserts any of it.
 *      Copy/href/test-id regressions ship silently.
 *
 *   2. The `tweaks.showOutcomes === false` outcomes-tile filter.
 *      H-1195 — the second filter pass in `visibleTiles` strips tiles with
 *      `k === "outcomes" || k === "outcomes-timeline"` when `showOutcomes`
 *      is false. The Tweaks suite verifies the localStorage write but NOT
 *      that the dashboard actually omits the tile when the knob flips.
 *
 * Both tests stub the V2 hook + WIDGET_COMPONENTS for determinism and
 * inspect rendered DOM via data-testid + data-widget-id markers (the same
 * markers WidgetGrid emits per cell).
 */

const { COMPOSITE_IDS, KPI_STRIP_ID } = vi.hoisted(() => ({
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
  KPI_STRIP_ID: "kpi-strip" as const,
}));

vi.mock("@/lib/analytics/usage-events-client", () => ({
  trackUsageEventClient: vi.fn(),
  identifyUsageUser: vi.fn(),
}));

vi.mock("./components/AlertBanner", () => ({
  AlertBanner: () => <div data-testid="alert-banner-stub" />,
}));

vi.mock("./widgets", () => {
  const WIDGET_COMPONENTS: Record<string, React.ComponentType<unknown>> = {};
  for (const id of [
    ...COMPOSITE_IDS,
    KPI_STRIP_ID,
    "outcomes",
    "outcomes-timeline",
  ]) {
    WIDGET_COMPONENTS[id] = () => (
      <div data-testid={`widget-body-${id}`}>widget-body-{id}</div>
    );
  }
  return { WIDGET_COMPONENTS };
});

// Hoisted holder so tests can swap the tile list per-test without
// re-mocking the hook.
const tilesHolder = vi.hoisted(() => ({
  tiles: [] as Array<{ k: string; w: 1 | 2 | 3 | 4 }>,
}));

vi.mock("./hooks/useDashboardConfig", () => ({
  useDashboardConfigV2: () => ({
    config: {
      tiles: tilesHolder.tiles,
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

import { AllocationDashboardV2 } from "./AllocationDashboardV2";

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  ) as unknown as typeof fetch;
  if (typeof globalThis.IntersectionObserver === "undefined") {
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

const BASE_PAYLOAD = {
  portfolio: null,
  analytics: null,
  apiKeys: [],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  equitySnapshots: [],
  // holdings present so we don't short-circuit to EmptyState
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

function withStrategy() {
  return {
    ...BASE_PAYLOAD,
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
            daily_returns: [{ date: "2026-01-01", value: 0.01 }],
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

describe("AllocationDashboardV2 — empty-grid callout (H-1194 / H-1196)", () => {
  it("renders the callout with singular copy when 1 strategy-composite tile is filtered", async () => {
    tilesHolder.tiles = [
      { k: KPI_STRIP_ID, w: 2 },
      { k: "rolling-sharpe", w: 2 }, // exactly one strategy-composite tile
    ];
    const { container, getByTestId } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboardV2 {...(BASE_PAYLOAD as any)} />,
    );

    const callout = await waitFor(() => getByTestId("empty-grid-callout"));
    // Singular copy when count === 1.
    expect(callout.textContent).toMatch(/Connect a strategy to unlock 1 widget(?!s)/);
    expect(callout.textContent).not.toMatch(/unlock 1 widgets/);

    const link = callout.querySelector(
      'a[href="/discovery"]',
    ) as HTMLAnchorElement | null;
    expect(link, "Browse strategies link must point to /discovery").not.toBeNull();
    expect(link?.textContent).toMatch(/Browse strategies/);

    // The non-composite kpi-strip still renders.
    expect(container.querySelector(`[data-widget-id="${KPI_STRIP_ID}"]`)).not.toBeNull();
    // The composite tile is filtered out.
    expect(container.querySelector('[data-widget-id="rolling-sharpe"]')).toBeNull();
  });

  it("renders the callout with plural copy when 3 strategy-composite tiles are filtered", async () => {
    tilesHolder.tiles = [
      { k: KPI_STRIP_ID, w: 2 },
      { k: "rolling-sharpe", w: 2 },
      { k: "correlation-matrix", w: 2 },
      { k: "regime-detector", w: 2 },
    ];
    const { getByTestId } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboardV2 {...(BASE_PAYLOAD as any)} />,
    );

    const callout = await waitFor(() => getByTestId("empty-grid-callout"));
    expect(callout.textContent).toMatch(/Connect a strategy to unlock 3 widgets/);
  });

  it("does NOT render the callout when strategies.length > 0 (gate inactive)", async () => {
    tilesHolder.tiles = [
      { k: KPI_STRIP_ID, w: 2 },
      { k: "rolling-sharpe", w: 2 },
    ];
    const { container, queryByTestId } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboardV2 {...(withStrategy() as any)} />,
    );

    // Wait for paint via the always-rendered non-composite widget.
    await waitFor(() => {
      expect(
        container.querySelector(`[data-widget-id="${KPI_STRIP_ID}"]`),
      ).not.toBeNull();
    });

    expect(queryByTestId("empty-grid-callout")).toBeNull();
    // The composite tile DOES render when strategies has rows.
    expect(container.querySelector('[data-widget-id="rolling-sharpe"]')).not.toBeNull();
  });

  it("does NOT render the callout when strategies=[] but NO strategy-composite tiles are persisted", async () => {
    // Only non-composite tiles — filteredStrategyTileCount === 0, no callout.
    tilesHolder.tiles = [{ k: KPI_STRIP_ID, w: 2 }];
    const { container, queryByTestId } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboardV2 {...(BASE_PAYLOAD as any)} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector(`[data-widget-id="${KPI_STRIP_ID}"]`),
      ).not.toBeNull();
    });

    expect(queryByTestId("empty-grid-callout")).toBeNull();
  });
});

describe("AllocationDashboardV2 — showOutcomes tweak filter (H-1195)", () => {
  // Seed localStorage with the Tweaks blob so TweaksProvider's hydration
  // effect surfaces showOutcomes:false on first paint. Mocking the hook
  // directly is cleaner; the production path is the same parseTweakState
  // pipeline either way.
  function mockUseTweaks(showOutcomes: boolean) {
    vi.doMock("./context/TweaksContext", async () => {
      const actual =
        await vi.importActual<typeof import("./context/TweaksContext")>(
          "./context/TweaksContext",
        );
      return {
        ...actual,
        useTweaks: () => ({
          state: { ...actual.TWEAK_DEFAULTS, showOutcomes },
          set: vi.fn(),
          reset: vi.fn(),
          panelOpen: false,
          togglePanel: vi.fn(),
          closePanel: vi.fn(),
        }),
      };
    });
  }

  it("filters out both 'outcomes' and 'outcomes-timeline' tiles when showOutcomes=false", async () => {
    vi.resetModules();
    mockUseTweaks(false);
    tilesHolder.tiles = [
      { k: "outcomes", w: 2 },
      { k: "outcomes-timeline", w: 2 },
      { k: KPI_STRIP_ID, w: 2 },
    ];
    const mod = await import("./AllocationDashboardV2");
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <mod.AllocationDashboardV2 {...(withStrategy() as any)} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector(`[data-widget-id="${KPI_STRIP_ID}"]`),
      ).not.toBeNull();
    });

    // Both outcomes-flavored tiles must be filtered out.
    expect(container.querySelector('[data-widget-id="outcomes"]')).toBeNull();
    expect(
      container.querySelector('[data-widget-id="outcomes-timeline"]'),
    ).toBeNull();
  });

  it("keeps both 'outcomes' and 'outcomes-timeline' tiles when showOutcomes=true (default)", async () => {
    vi.resetModules();
    mockUseTweaks(true);
    tilesHolder.tiles = [
      { k: "outcomes", w: 2 },
      { k: "outcomes-timeline", w: 2 },
      { k: KPI_STRIP_ID, w: 2 },
    ];
    const mod = await import("./AllocationDashboardV2");
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <mod.AllocationDashboardV2 {...(withStrategy() as any)} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector(`[data-widget-id="${KPI_STRIP_ID}"]`),
      ).not.toBeNull();
    });

    expect(
      container.querySelector('[data-widget-id="outcomes"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-widget-id="outcomes-timeline"]'),
    ).not.toBeNull();
  });
});
