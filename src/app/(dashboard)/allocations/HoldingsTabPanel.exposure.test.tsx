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
import type { NetExposurePoint, AllocationPoint } from "@/lib/portfolio-exposure";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

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

type HoldingsRows = MyAllocationDashboardPayload["holdingsSummary"];

/**
 * Phase 170.4 plan 01 (D-01): the Exposure card is built from the panel's own
 * `holdingsSummary`, the array Holdings and Open Positions split, so the
 * fixtures drive the card through `holdingsSummary` and never through a
 * snapshot on the `exposure` prop.
 */
function holding(
  over: Partial<HoldingsRows[number]> & Pick<HoldingsRows[number], "symbol" | "value_usd">,
): HoldingsRows[number] {
  return {
    quantity: 1,
    mark_price_usd: null,
    venue: "deribit",
    holding_type: "derivative",
    api_key_id: "key-deribit",
    side: "long",
    entry_price: null,
    unrealized_pnl_usd: null,
    asof: "2026-10-03",
    ...over,
  };
}

function renderPanel(
  exposure: ExposureSectionData,
  holdingsSummary: HoldingsRows = [],
  apiKeys: unknown[] = [],
) {
  return render(
    <HoldingsTabPanel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...(BASE_PAYLOAD as any)}
      holdingsSummary={holdingsSummary}
      apiKeys={apiKeys}
      exposure={exposure}
    />,
  );
}

// The 2026-10-03 PROD reading: 3 Deribit positions, 185.1K gross.
const DERIBIT_BOOK: HoldingsRows = [
  holding({ symbol: "BTC-PERP", side: "long", value_usd: 100000 }),
  holding({ symbol: "ETH-PERP", side: "short", value_usd: 50000 }),
  holding({ symbol: "BTC-27DEC26-60000-C", side: "long", value_usd: 35100 }),
];

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
    expect(section.textContent).toContain("No current positions.");
    expect(section.textContent).toContain("No exposure history yet.");
    expect(section.textContent).toContain("No allocation history yet.");
    // No chart rendered on the honest-empty path.
    expect(section.querySelectorAll("svg").length).toBe(0);
  });

  it("builds the Exposure card from holdingsSummary: gross KPI and one drilldown row per position (D-01)", () => {
    const { container } = renderPanel(EMPTY_EXPOSURE, DERIBIT_BOOK);
    const section = container.querySelector('section[aria-label="Exposure"]')!;
    expect(section.querySelector('[data-testid="kpi-gross"]')!.textContent).toBe("$185.1K");
    expect(section.querySelector('[data-testid="kpi-net"]')!.textContent).toBe("$85.1K");
    expect(section.querySelectorAll('[data-testid="drilldown"] tbody tr')).toHaveLength(3);
    expect(section.textContent).toContain("as of 2026-10-03");
    expect(section.textContent).not.toContain("No current positions.");
  });

  it("names each drilldown row's key by the one key-label rule, from the panel's apiKeys (D-08)", () => {
    const { container } = renderPanel(
      EMPTY_EXPOSURE,
      [
        holding({ symbol: "BTC", venue: "binance", holding_type: "spot", side: "flat", value_usd: 40000, api_key_id: "key-a" }),
        holding({ symbol: "BTC", venue: "binance", holding_type: "spot", side: "flat", value_usd: 25000, api_key_id: "key-b" }),
      ],
      [{ id: "key-a", exchange: "binance", label: "Main" }],
    );
    const rows = container.querySelectorAll(
      'section[aria-label="Exposure"] [data-testid="drilldown"] tbody tr',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Binance — Main");
    expect(rows[1].textContent).not.toContain("key-b");
    expect(container.querySelector('[data-testid="kpi-gross"]')!.textContent).toBe("$65K");
  });

  it("shows the card's empty copy when holdingsSummary is empty, whatever the series hold", () => {
    const { container } = renderPanel(EMPTY_EXPOSURE, []);
    const section = container.querySelector('section[aria-label="Exposure"]')!;
    expect(section.querySelector('[data-testid="kpi-gross"]')).toBeNull();
    expect(section.textContent).toContain("No current positions.");
  });

  it("renders all three widget titles + as-of stamps when populated", () => {
    const holdingsSummary: HoldingsRows = [
      holding({ symbol: "BTC", venue: "binance", holding_type: "spot", side: "flat", value_usd: 300, asof: "2024-03-01" }),
      holding({ symbol: "ETH", venue: "okx", side: "short", value_usd: 100, asof: "2024-03-01" }),
      holding({ symbol: "SOL", venue: "coinbase", holding_type: "spot", side: "flat", value_usd: 50, asof: "2024-03-01" }),
    ];
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

    const { container } = renderPanel(
      {
        netSeries: { points: netPoints, gaps: [] },
        allocationSeries: { points: allocPoints, gaps: [] },
      },
      holdingsSummary,
    );
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
    const holdingsSummary: HoldingsRows = Array.from({ length: 40 }, (_, i) =>
      holding({
        symbol: `SYM${i}`,
        venue: venues[i % venues.length],
        holding_type: i % 2 === 0 ? "spot" : "derivative",
        side: i % 3 === 0 ? "short" : "long",
        value_usd: 100 + i,
        asof: isoDay(519),
      }),
    );

    expect(() =>
      renderPanel(
        {
          netSeries: { points: netPoints, gaps: [] },
          allocationSeries: { points: allocPoints, gaps: [] },
        },
        holdingsSummary,
      ),
    ).not.toThrow();
    const { container } = renderPanel(
      {
        netSeries: { points: netPoints, gaps: [] },
        allocationSeries: { points: allocPoints, gaps: [] },
      },
      holdingsSummary,
    );
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
  const snapshotBuilder = join(HERE, "lib/exposure-snapshot.ts");

  it("no widget/chart-gaps source imports the admin client or names allocator_holdings", () => {
    for (const f of [...widgetFiles, chartGaps]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toContain("createAdminClient");
      expect(src).not.toContain("allocator_holdings");
    }
  });

  it("the pure snapshot builder names no holdings table and imports no Supabase client (T-170.4-03)", () => {
    const src = readFileSync(snapshotBuilder, "utf8");
    expect(src).not.toContain("allocator_holdings");
    expect(src).not.toMatch(/supabase\/(server|admin)/);
    expect(src).not.toContain("createAdminClient");
    expect(src).not.toContain("server-only");
    // The data-contract types come in TYPE-ONLY, like the widgets (T-99-01).
    expect(src).not.toMatch(/import\s+\{[^}]*\}\s+from\s+["']@\/lib\/portfolio-exposure["']/);
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
