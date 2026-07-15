import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 99 / 99-04 — integration coverage for the Exposure section wired into
 * HoldingsTabPanel: placement/order, honest-empty trio, populated render, and
 * a >1000-row-backed VOLUME shape (Phase-98 pagination carry-forward at the
 * render level; the LIVE read confirmation is the Task 3 human checkpoint).
 * Plus a source-level trust-boundary lock (UI-SPEC verification intent 6).
 *
 * The strategy/position child tables are mocked to lightweight markers so the
 * payload can stay minimal and the DOM order is unambiguous; the three exposure
 * widgets render FOR REAL (they are what is under test). ResponsiveContainer is
 * mocked so recharts gets a measured box in jsdom.
 */

vi.mock("./components/HoldingsTable", () => ({
  HoldingsTable: (props: { strategyRows?: unknown[] }) =>
    props.strategyRows ? (
      <div data-testid="strategies-marker">STRATEGIES_SECTION</div>
    ) : (
      <div data-testid="spot-holdings-marker" />
    ),
}));
vi.mock("./components/OpenPositionsTable", () => ({
  OpenPositionsTable: () => <div data-testid="open-positions-marker" />,
}));
vi.mock("./ScenarioFlaggedHoldingsList", () => ({
  ScenarioFlaggedHoldingsList: () => <div data-testid="flagged-marker" />,
}));
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 300 }}>{children}</div>
    ),
  };
});

import { HoldingsTabPanel } from "./HoldingsTabPanel";
import { EMPTY_EXPOSURE, type ExposureSectionData } from "./lib/exposure-props";
import type {
  ExposureSnapshot,
  NetExposurePoint,
  AllocationPoint,
} from "@/lib/portfolio-exposure";

// Minimal MyAllocationDashboardPayload — the panel only reads these fields; the
// child tables are mocked, so the rest is irrelevant to the exposure section.
const BASE_PAYLOAD = {
  holdingsSummary: [],
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  apiKeys: [],
  strategies: [],
  mandate: null,
};

function renderPanel(exposure: ExposureSectionData) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<HoldingsTabPanel {...(BASE_PAYLOAD as any)} exposure={exposure} />);
}

/** UTC day loop — no timezone drift. Day 0 = 2024-01-01. */
function isoDay(i: number): string {
  return new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
}

describe("HoldingsTabPanel — Exposure section (99-04 wiring)", () => {
  it("places the Exposure section BETWEEN Strategies and Exchange Positions", () => {
    const { container } = renderPanel(EMPTY_EXPOSURE);
    const text = container.textContent ?? "";
    const iStrategies = text.indexOf("STRATEGIES_SECTION");
    const iExposure = text.indexOf("Exposure");
    const iExchange = text.indexOf("Exchange Positions");
    expect(iStrategies).toBeGreaterThanOrEqual(0);
    expect(iExposure).toBeGreaterThanOrEqual(0);
    expect(iExchange).toBeGreaterThanOrEqual(0);
    expect(iStrategies).toBeLessThan(iExposure);
    expect(iExposure).toBeLessThan(iExchange);

    // The section is a real landmark with the aria-label the UI-SPEC pins.
    const section = container.querySelector('section[aria-label="Exposure"]');
    expect(section).not.toBeNull();
  });

  it("renders the honest-empty trio and NO chart svg when exposure is empty", () => {
    const { container } = renderPanel(EMPTY_EXPOSURE);
    const section = container.querySelector('section[aria-label="Exposure"]')!;
    expect(section.textContent).toContain("No position snapshot yet.");
    expect(section.textContent).toContain("No exposure history yet.");
    expect(section.textContent).toContain("No allocation history yet.");
    // No chart rendered on the honest-empty path.
    expect(section.querySelectorAll("svg").length).toBe(0);
  });

  it("renders all three widget titles + as-of stamps when populated", () => {
    const snapshot: ExposureSnapshot = {
      asof: "2024-03-01",
      slices: [
        { holdingType: "spot", venue: "binance", symbol: "BTC", side: "long", valueUsd: 300, signedValueUsd: 300 },
        { holdingType: "derivative", venue: "okx", symbol: "ETH", side: "short", valueUsd: 100, signedValueUsd: -100 },
        { holdingType: "spot", venue: "coinbase", symbol: "SOL", side: "long", valueUsd: 50, signedValueUsd: 50 },
      ],
      totalGrossUsd: 450,
      totalNetUsd: 250,
    };
    const netPoints: NetExposurePoint[] = Array.from({ length: 5 }, (_, i) => ({
      asof: isoDay(i),
      netUsd: 100 + i * 10,
      grossUsd: 200 + i * 10,
    }));
    const allocPoints: AllocationPoint[] = Array.from({ length: 5 }, (_, i) => ({
      asof: isoDay(i),
      venues: [
        { venue: "binance", valueUsd: 60, weight: 0.6 },
        { venue: "okx", valueUsd: 40, weight: 0.4 },
      ],
    }));

    const { container } = renderPanel({
      snapshot,
      netSeries: { points: netPoints, gaps: [] },
      allocationSeries: { points: allocPoints, gaps: [] },
    });
    const section = container.querySelector('section[aria-label="Exposure"]')!;
    expect(section.textContent).toContain("Exposure by asset class");
    expect(section.textContent).toContain("Net exposure over time");
    expect(section.textContent).toContain("Allocation over time");
    // As-of stamps: snapshot asof + the last point of each series.
    expect(section.textContent).toContain("as of 2024-03-01");
    expect(section.textContent).toContain(`as of ${isoDay(4)}`);
  });

  it("renders a >1000-row-backed volume shape without throwing (Phase-98 carry-forward)", () => {
    // 520 daily points × 6 venues (allocation) + 520 net points + 40-slice
    // snapshot ≈ a 3120-row-backed allocation window — well past PostgREST's
    // 1000-row max_rows cap that the paginated read defends against.
    const venues = ["binance", "okx", "bybit", "coinbase", "kraken", "deribit"];
    const netPoints: NetExposurePoint[] = Array.from({ length: 520 }, (_, i) => ({
      asof: isoDay(i),
      netUsd: 1000 + i,
      grossUsd: 2000 + i,
    }));
    const allocPoints: AllocationPoint[] = Array.from({ length: 520 }, (_, i) => ({
      asof: isoDay(i),
      venues: venues.map((venue, v) => ({
        venue,
        valueUsd: 100 + v,
        weight: (100 + v) / (600 + 15),
      })),
    }));
    const snapshot: ExposureSnapshot = {
      asof: isoDay(519),
      slices: Array.from({ length: 40 }, (_, i) => ({
        holdingType: i % 2 === 0 ? "spot" : "derivative",
        venue: venues[i % venues.length],
        symbol: `SYM${i}`,
        side: i % 3 === 0 ? "short" : "long",
        valueUsd: 100 + i,
        signedValueUsd: i % 3 === 0 ? -(100 + i) : 100 + i,
      })),
      totalGrossUsd: 5000,
      totalNetUsd: 1200,
    };

    expect(() =>
      renderPanel({
        snapshot,
        netSeries: { points: netPoints, gaps: [] },
        allocationSeries: { points: allocPoints, gaps: [] },
      }),
    ).not.toThrow();
    const { container } = renderPanel({
      snapshot,
      netSeries: { points: netPoints, gaps: [] },
      allocationSeries: { points: allocPoints, gaps: [] },
    });
    expect(
      container.querySelector('section[aria-label="Exposure"]'),
    ).not.toBeNull();
  });
});

describe("Exposure trust-boundary source lock (UI-SPEC intent 6)", () => {
  const HERE = __dirname;
  const widgetFiles = [
    join(HERE, "widgets/positions/ExposureByClass.tsx"),
    join(HERE, "widgets/positions/NetExposureChart.tsx"),
    join(HERE, "widgets/allocation/AllocationOverTime.tsx"),
  ];
  const chartGaps = join(HERE, "widgets/lib/chart-gaps.tsx");
  const pageFile = join(HERE, "page.tsx");

  it("no widget/chart-gaps source imports the admin client or names allocator_holdings", () => {
    for (const f of [...widgetFiles, chartGaps]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toContain("createAdminClient");
      expect(src).not.toContain("allocator_holdings");
    }
  });

  it("each widget imports portfolio-exposure as TYPE-ONLY (no runtime coupling)", () => {
    for (const f of widgetFiles) {
      const src = readFileSync(f, "utf8");
      // If it references the read module at all, it must be `import type`.
      if (src.includes("@/lib/portfolio-exposure")) {
        expect(src).toMatch(
          /import\s+type\s+\{[^}]*\}\s+from\s+["']@\/lib\/portfolio-exposure["']/,
        );
        // And never a value import of it.
        expect(src).not.toMatch(
          /import\s+\{[^}]*\}\s+from\s+["']@\/lib\/portfolio-exposure["']/,
        );
      }
    }
  });

  it("page.tsx never names allocator_holdings (its funnel admin block is out of scope)", () => {
    const src = readFileSync(pageFile, "utf8");
    expect(src).not.toContain("allocator_holdings");
  });
});
