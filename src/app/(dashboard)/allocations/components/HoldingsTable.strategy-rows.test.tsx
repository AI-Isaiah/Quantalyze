import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { HoldingsTable } from "./HoldingsTable";
import { toStrategyRows } from "../lib/strategies-row-adapter";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

/**
 * F4b render coverage — the production strategy-rows path end-to-end.
 *
 * The Holdings tab renders `<HoldingsTable strategyRows={toStrategyRows({…})} />`
 * (HoldingsTabPanel.tsx). Every other allocations test that touches
 * HoldingsTable either MOCKS the component (HoldingsTabPanel.test.tsx line 25)
 * or exercises the legacy/design branch — so the `StrategyRowsTable` render
 * (8 sortable columns + per-row factsheet `<Link>`) had ZERO render coverage,
 * and the e2e suite never clicks the Holdings tab. A render-time crash in that
 * branch would slip past tsc, lint, the adapter's data-only unit tests, and CI
 * e2e alike.
 *
 * This test renders the REAL HoldingsTable fed by the REAL adapter output and
 * locks the H-0062/H-0063/H-0064 closure: the pre-F4b table shipped 6-of-9
 * columns as "—" for every row (hardcoded `allocated_at: null` + empty
 * holding→strategy map). These assertions prove the columns now carry real
 * derived values, and would fail against that all-dashes regression.
 */

type PayloadStrategy = MyAllocationDashboardPayload["strategies"][number];

// next/navigation: HoldingsTable imports useRouter at module scope (legacy
// DesignHoldingsTable uses it). StrategyRowsTable does not call it, but the
// import must resolve in jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/allocations",
  useSearchParams: () => new URLSearchParams(),
}));

// next/link → plain anchor so we can assert the factsheet href directly.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** Minimal payload-strategy fixture (mirrors strategies-row-adapter.test.ts). */
function makeStrategy(over: {
  strategy_id?: string;
  current_weight?: number | null;
  allocated_amount?: number | null;
  alias?: string | null;
  added_at?: string;
  strategy?: Partial<PayloadStrategy["strategy"]>;
}): PayloadStrategy {
  return {
    strategy_id: over.strategy_id ?? "s-1",
    current_weight: over.current_weight ?? null,
    allocated_amount: over.allocated_amount ?? null,
    alias: over.alias ?? null,
    added_at: over.added_at ?? "2026-05-03T00:00:00Z",
    eligible_for_outcome: false,
    existing_outcome: null,
    strategy: {
      id: over.strategy?.id ?? "s-1",
      name: over.strategy?.name ?? null,
      codename: over.strategy?.codename ?? null,
      disclosure_tier: over.strategy?.disclosure_tier ?? "exploratory",
      strategy_types: over.strategy?.strategy_types ?? [],
      markets: over.strategy?.markets ?? [],
      start_date: over.strategy?.start_date ?? null,
      organization_name: over.strategy?.organization_name ?? null,
      strategy_analytics:
        over.strategy?.strategy_analytics !== undefined
          ? over.strategy.strategy_analytics
          : null,
    },
  };
}

const NOW = new Date("2026-06-02T00:00:00Z");

function renderRows(strategies: PayloadStrategy[]) {
  return render(
    <HoldingsTable strategyRows={toStrategyRows({ strategies, now: NOW })} />,
  );
}

describe("HoldingsTable — strategy-rows render (F4b)", () => {
  it("renders the Strategies table with all eight column headers", () => {
    renderRows([makeStrategy({ strategy_id: "a", alias: "Alpha Book" })]);

    expect(screen.getByText("Strategies")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveAttribute("data-table", "strategies");

    for (const header of [
      "Strategy",
      "Manager",
      "Weight",
      "Allocation",
      "MTD",
      "Sharpe",
      "Max DD",
      "Age",
    ]) {
      expect(
        within(table).getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
  });

  it("emits one row per strategy keyed by strategy_id", () => {
    const { container } = renderRows([
      makeStrategy({ strategy_id: "a", alias: "A" }),
      makeStrategy({ strategy_id: "b", alias: "B" }),
      makeStrategy({ strategy_id: "c", alias: "C" }),
    ]);
    const rows = container.querySelectorAll("[data-strategy-row]");
    expect(rows).toHaveLength(3);
    expect(
      [...rows].map((r) => r.getAttribute("data-strategy-row")).sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("links each strategy name to its factsheet", () => {
    const { container } = renderRows([
      makeStrategy({ strategy_id: "strat-42", alias: "Delta Neutral" }),
    ]);
    const row = container.querySelector('[data-strategy-row="strat-42"]')!;
    const link = within(row as HTMLElement).getByRole("link", {
      name: "Delta Neutral",
    });
    expect(link).toHaveAttribute("href", "/factsheet/strat-42");
  });

  describe("Manager column preserves disclosure-tier redaction", () => {
    it("shows the organization name when present (institutional, server-unredacted)", () => {
      const { container } = renderRows([
        makeStrategy({
          strategy_id: "inst",
          alias: "Inst Book",
          strategy: {
            disclosure_tier: "institutional",
            organization_name: "Helios Capital",
            codename: "NEBULA",
          },
        }),
      ]);
      const row = container.querySelector('[data-strategy-row="inst"]')!;
      expect(within(row as HTMLElement).getByText("Helios Capital")).toBeInTheDocument();
    });

    it("falls back to the codename pseudonym when org is null (redacted tier)", () => {
      const { container } = renderRows([
        makeStrategy({
          strategy_id: "expl",
          alias: "Expl Book",
          strategy: {
            disclosure_tier: "exploratory",
            organization_name: null,
            codename: "NEBULA",
          },
        }),
      ]);
      const row = container.querySelector('[data-strategy-row="expl"]')!;
      expect(within(row as HTMLElement).getByText("NEBULA")).toBeInTheDocument();
    });

    it("renders an em dash when neither org nor codename is known", () => {
      const { container } = renderRows([
        makeStrategy({
          strategy_id: "anon",
          alias: "Anon Book",
          strategy: { organization_name: null, codename: null },
        }),
      ]);
      const row = container.querySelector('[data-strategy-row="anon"]')!;
      // 2nd cell is Manager.
      const managerCell = row.querySelectorAll("td")[1];
      expect(managerCell.textContent).toBe("—");
    });
  });

  it("renders real values across all six metric columns — the H-0062/63/64 anti-regression", () => {
    // Fully-populated row: weight, allocation, MTD (from daily_returns),
    // sharpe, maxDd, and a positive age. None of these may render "—".
    const { container } = renderRows([
      makeStrategy({
        strategy_id: "full",
        alias: "Full Book",
        current_weight: 0.42,
        allocated_amount: 128_400,
        added_at: "2026-05-03T00:00:00Z", // 30 days before NOW
        strategy: {
          disclosure_tier: "institutional",
          organization_name: "Helios Capital",
          strategy_analytics: {
            daily_returns: { "2026-06-01": 0.01, "2026-06-02": 0.02 } as never,
            cagr: null,
            sharpe: 1.8,
            volatility: null,
            max_drawdown: -0.064,
          },
        },
      }),
    ]);
    const row = container.querySelector('[data-strategy-row="full"]')!;
    const cells = [...row.querySelectorAll("td")].map((c) => c.textContent ?? "");
    // [Strategy, Manager, Weight, Allocation, MTD, Sharpe, Max DD, Age]
    expect(cells).toHaveLength(8);
    // Strategy + Manager carry real identity.
    expect(cells[0]).toContain("Full Book");
    expect(cells[1]).toBe("Helios Capital");
    // The six metric columns must all be non-dash (the old table was all "—").
    for (let i = 2; i < 8; i++) {
      expect(cells[i]).not.toBe("—");
      expect(cells[i].trim().length).toBeGreaterThan(0);
    }
    // Age is derived from added_at, not hardcoded null (H-0062).
    expect(cells[7]).toBe("30d");
  });

  it("renders em dashes for genuinely-absent metrics but still a real age", () => {
    const { container } = renderRows([
      makeStrategy({
        strategy_id: "sparse",
        alias: "Sparse Book",
        current_weight: null,
        allocated_amount: null,
        added_at: "2026-05-23T00:00:00Z", // 10 days before NOW
        strategy: { strategy_analytics: null },
      }),
    ]);
    const row = container.querySelector('[data-strategy-row="sparse"]')!;
    const cells = [...row.querySelectorAll("td")].map((c) => c.textContent ?? "");
    expect(cells[2]).toBe("—"); // weight
    expect(cells[4]).toBe("—"); // mtd
    expect(cells[5]).toBe("—"); // sharpe
    expect(cells[6]).toBe("—"); // maxDd
    // Age is never null from the adapter — it is computed from added_at.
    expect(cells[7]).toBe("10d");
  });

  it("shows the empty state (no table) when there are no strategies", () => {
    renderRows([]);
    expect(screen.getByText("No strategies onboarded yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("reorders rows when a sortable header is clicked", () => {
    const { container } = renderRows([
      makeStrategy({ strategy_id: "low", alias: "Zeta", allocated_amount: 10 }),
      makeStrategy({ strategy_id: "high", alias: "Alpha", allocated_amount: 1_000 }),
    ]);
    const ids = () =>
      [...container.querySelectorAll("[data-strategy-row]")].map((r) =>
        r.getAttribute("data-strategy-row"),
      );
    // Default sort is allocation desc → high first.
    expect(ids()).toEqual(["high", "low"]);

    // Sort by Strategy: first click is desc (Zeta > Alpha) → low first.
    // The sort handler lives on the header's <button>, not the <th>.
    fireEvent.click(screen.getByRole("button", { name: "Strategy" }));
    expect(ids()).toEqual(["low", "high"]);

    // Second click flips to asc (Alpha < Zeta) → high first.
    fireEvent.click(screen.getByRole("button", { name: "Strategy" }));
    expect(ids()).toEqual(["high", "low"]);
  });
});
