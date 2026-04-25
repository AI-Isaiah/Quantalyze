import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Phase 09.1 PR1 (dashboard parity, HANDOFF.md G3) — InsightStrip mount
 * invariants on the V2 Overview shell.
 *
 *   1. The shell mounts a `<section aria-label="Portfolio insights">`
 *      sibling to WidgetGrid, above the grid in DOM order, below
 *      AlertBanner.
 *   2. The empty-state path (zero analytics insights AND zero flagged
 *      holdings) renders the HANDOFF.md fallback copy verbatim:
 *      "No unusual activity in the trailing window."
 *   3. Flagged holdings count threads through to the strip's bridge-link
 *      bullet (presence is the signal — no count → no bullet).
 *
 * Stubs WIDGET_COMPONENTS / useDashboardConfigV2 / AlertBanner / Tweaks
 * so the test asserts only on the shell's mount order — widget bodies
 * are deterministic markers.
 */

const STUB_TILES = [{ k: "kpi-strip", w: 4 as const }];

vi.mock("@/lib/analytics/usage-events-client", () => ({
  trackUsageEventClient: vi.fn(),
  identifyUsageUser: vi.fn(),
}));

vi.mock("./components/AlertBanner", () => ({
  AlertBanner: () => <div data-testid="alert-banner-stub" />,
}));

vi.mock("./components/Tweaks", () => ({
  Tweaks: () => null,
}));

vi.mock("./widgets", () => ({
  WIDGET_COMPONENTS: {
    "kpi-strip": () => <div data-testid="kpi-strip-stub" />,
  },
}));

vi.mock("./hooks/useDashboardConfig", () => ({
  useDashboardConfigV2: () => ({
    config: {
      tiles: STUB_TILES,
      timeframe: "YTD",
      layoutVersion: 7,
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
  portfolio: { id: "p-1", name: "Test Portfolio", created_at: "2026-01-01T00:00:00Z" },
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
      api_key_id: "ak-1",
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
        strategy_analytics: null,
      },
    },
  ],
  mandate: null,
};

function renderShell(payloadOverrides: Partial<typeof BASE_PAYLOAD> = {}) {
  return render(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <AllocationDashboardV2 {...({ ...BASE_PAYLOAD, ...payloadOverrides } as any)} />,
  );
}

describe("AllocationDashboardV2 — InsightStrip mount (PR1)", () => {
  it("mounts <section aria-label='Portfolio insights'> above WidgetGrid in DOM order (when there's anything to render)", async () => {
    // PR3 — InsightStrip returns null when there's nothing to say. Pass a
    // non-empty flaggedHoldings list so the section actually mounts and
    // the DOM-order assertions below have something to check.
    const { container } = renderShell({
      // BASE_PAYLOAD's flaggedHoldings: [] gets inferred as never[];
      // cast the whole array so a populated row passes typecheck.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      flaggedHoldings: [
        {
          holding_ref: "holding:binance:BTC:spot",
          venue: "binance",
          symbol: "BTC",
          holding_type: "spot",
          value_usd: 90000,
          weight: 1,
          breach_reasons: ["max_weight"],
          top_candidate_strategy_id: "strat-x",
          top_candidate_strategy_name: "Helios Perp Basis",
          top_candidate_composite: 80,
        },
      ] as any,
    });

    // Wait for the grid to mount.
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="kpi-strip-stub"]'),
      ).not.toBeNull();
    });

    const insightStrip = container.querySelector(
      'section[aria-label="Portfolio insights"]',
    );
    expect(insightStrip).not.toBeNull();

    // DOM order: AlertBanner → InsightStrip → WidgetGrid container. Compare
    // document positions to assert sibling order.
    const banner = container.querySelector('[data-testid="alert-banner-stub"]');
    const grid = container.querySelector('[data-testid="kpi-strip-stub"]');
    expect(banner).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(
      banner!.compareDocumentPosition(insightStrip!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      "InsightStrip should follow AlertBanner in DOM order",
    ).toBeGreaterThan(0);
    expect(
      insightStrip!.compareDocumentPosition(grid!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      "WidgetGrid (kpi-strip-stub) should follow InsightStrip in DOM order",
    ).toBeGreaterThan(0);
  });

  it("PR3 (dashboard parity) — InsightStrip stays unmounted when zero insights AND zero flagged", () => {
    // PR3 silenced the loud empty state to match the truth screenshot:
    // when there's nothing to say, the strip renders null so the Bridge
    // banner sits flush below the tab row instead of being pushed down
    // by a "WHAT WE NOTICED · No unusual activity" block.
    const { queryByText, queryByRole } = renderShell({
      analytics: null,
      flaggedHoldings: [],
    });
    expect(
      queryByText("No unusual activity in the trailing window."),
    ).toBeNull();
    expect(
      queryByRole("region", { name: "Portfolio insights" }),
    ).toBeNull();
  });

  it("flagged-holdings count surfaces a 'Bridge flagged N holding(s)' bullet linking to Scenario", async () => {
    const flagged = [
      {
        holding_ref: "holding:binance:BTC:spot",
        venue: "binance",
        symbol: "BTC",
        holding_type: "spot" as const,
        value_usd: 90000,
        weight: 1,
        breach_reasons: ["max_weight"],
        top_candidate_strategy_id: "strat-x",
        top_candidate_strategy_name: "Helios Perp Basis",
        top_candidate_composite: 80,
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { findByText } = renderShell({ flaggedHoldings: flagged as any });
    const link = await findByText(/Bridge flagged 1 holding\(s\)/);
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute(
      "href",
      "/allocations?tab=scenario",
    );
  });
});
