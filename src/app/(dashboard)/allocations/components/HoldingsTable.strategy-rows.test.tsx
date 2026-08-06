import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { HoldingsTable } from "./HoldingsTable";
import { HoldingsTabPanel } from "../HoldingsTabPanel";
import { EMPTY_EXPOSURE } from "../lib/exposure-props";
import { toStrategyRows } from "../lib/strategies-row-adapter";
import type {
  MyAllocationDashboardPayload,
  OwnCapitalStrategy,
} from "@/lib/queries";

/**
 * F4b render coverage — the production strategy-rows path end-to-end.
 *
 * The Holdings tab renders `<HoldingsTable strategyRows={toStrategyRows({…})} />`
 * (HoldingsTabPanel.tsx). Every other allocations test that touches
 * HoldingsTable either MOCKS the component (HoldingsTabPanel.test.tsx line 29)
 * or exercises the legacy/design branch — so the `StrategyRowsTable` render
 * had ZERO render coverage, and the e2e suite never clicks the Holdings tab. A
 * render-time crash in that branch would slip past tsc, lint, the adapter's
 * data-only unit tests, and CI e2e alike.
 *
 * This test renders the REAL HoldingsTable fed by the REAL adapter output and
 * locks two things:
 *
 *   1. the H-0062/H-0063/H-0064 closure — the pre-F4b table shipped 6-of-9
 *      columns as "—" for every row (hardcoded `allocated_at: null` + empty
 *      holding→strategy map). These assertions prove the columns carry real
 *      derived values and would fail against that all-dashes regression.
 *   2. Phase 150 / OWN-03 (D-12-A / D-12-B / D-13 / D-15) — the UNION row set,
 *      the render-derived UNSIGNED Weight cell, the mutually-exclusive
 *      Allocate…/Edit allocation… affordance, and the three empty-state arms.
 *
 * Fixtures feed the adapter's TWO inputs deliberately: `positions` (the
 * `portfolio_strategies` half) and `strategies` (the own-capital marked half),
 * because the affordance and the weight denominator both depend on which half
 * a row came from.
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

// Plan 07 Task 3 mounts HoldingsTabPanel (the dialog host) in the
// portfolio-null case below. Two environment stubs it needs:
//   - the OptimizerPanel pulls the shared PortfolioOptimizer through
//     next/dynamic and it calls useRouter (HoldingsTabPanel.test.tsx:49-51);
//   - jsdom does not implement HTMLDialogElement.showModal()/close(), which
//     the Modal primitive calls from a useEffect (Modal.test.tsx:23-39).
vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));

if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
      (this as unknown as { open: boolean }).open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      (this as unknown as { open: boolean }).open = false;
    };
  }
}

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
      trust_tier: over.strategy?.trust_tier ?? null,
      is_composite: over.strategy?.is_composite ?? false,
      series_state: over.strategy?.series_state ?? "empty",
      strategy_analytics:
        over.strategy?.strategy_analytics !== undefined
          ? over.strategy.strategy_analytics
          : null,
    },
  };
}

/** Minimal own-capital marked-strategy fixture (the getOwnCapitalStrategies shape). */
function makeMarked(over: {
  id?: string;
  name?: string | null;
  codename?: string | null;
  capital_ownership?: string | null;
  analytics?: OwnCapitalStrategy["strategy_analytics"];
}): OwnCapitalStrategy {
  return {
    id: over.id ?? "m-1",
    name: over.name === undefined ? "Helios Basis" : over.name,
    codename: over.codename ?? null,
    disclosure_tier: "exploratory",
    status: "private",
    capital_ownership: (over.capital_ownership === undefined
      ? "own_capital"
      : over.capital_ownership) as OwnCapitalStrategy["capital_ownership"],
    strategy_analytics: over.analytics ?? null,
  };
}

const NOW = new Date("2026-06-02T00:00:00Z");

function renderRows(args: {
  strategies?: OwnCapitalStrategy[];
  positions?: PayloadStrategy[];
  hasAnyStrategies?: boolean;
  onAllocate?: (row: { id: string }) => void;
  onEditAllocation?: (row: { id: string }) => void;
}) {
  return render(
    <HoldingsTable
      strategyRows={toStrategyRows({
        strategies: args.strategies ?? [],
        positions: args.positions ?? [],
        now: NOW,
      })}
      hasAnyStrategies={args.hasAnyStrategies ?? false}
      onAllocate={args.onAllocate}
      onEditAllocation={args.onEditAllocation}
    />,
  );
}

/** Positions-only render — the pre-150 shape, now the "unmarked" union half. */
function renderPositions(positions: PayloadStrategy[]) {
  return renderRows({ positions });
}

describe("HoldingsTable — strategy-rows render (F4b)", () => {
  it("renders the Strategies table with all nine column headers", () => {
    renderPositions([makeStrategy({ strategy_id: "a", alias: "Alpha Book" })]);

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
      "Actions",
    ]) {
      expect(
        within(table).getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
  });

  it("emits one row per strategy keyed by strategy_id", () => {
    const { container } = renderPositions([
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
    const { container } = renderPositions([
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
      const { container } = renderPositions([
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
      const { container } = renderPositions([
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
      const { container } = renderPositions([
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
    // Fully-populated MARKED + ALLOCATED row: weight (derived), allocation,
    // MTD (from daily_returns), sharpe, maxDd, and a positive age. None of
    // these may render "—".
    //
    // The Weight cell is derived (D-12-B), so the fixture must be a UNION row —
    // a bare payload row has no marked half and its derived share is genuinely
    // null. This restores the real Weight assertion the 150-05 HAND-OFF
    // exempted.
    const { container } = renderRows({
      strategies: [makeMarked({ id: "full", name: "Full Book" })],
      positions: [
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
      ],
    });
    const row = container.querySelector('[data-strategy-row="full"]')!;
    const cells = [...row.querySelectorAll("td")].map((c) => c.textContent ?? "");
    // [Strategy, Manager, Weight, Allocation, MTD, Sharpe, Max DD, Age, Actions]
    expect(cells).toHaveLength(9);
    // Strategy + Manager carry real identity.
    expect(cells[0]).toContain("Full Book");
    expect(cells[1]).toBe("Helios Capital");
    for (let i = 2; i < 8; i++) {
      expect(cells[i]).not.toBe("—");
      expect(cells[i].trim().length).toBeGreaterThan(0);
    }
    // Sole allocated own-capital row → it is the whole allocated book.
    expect(cells[2]).toBe("100.00%");
    // Age is derived from added_at, not hardcoded null (H-0062).
    expect(cells[7]).toBe("30d");
  });

  it("renders em dashes for genuinely-absent metrics but still a real age", () => {
    const { container } = renderPositions([
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
    // Age is never null on a POSITION row — it is computed from added_at.
    expect(cells[7]).toBe("10d");
  });

  it("reorders rows when a sortable header is clicked", () => {
    const { container } = renderPositions([
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

// ═══════════════════════════════════════ Phase 150 / OWN-03 — D-12-A / D-12-B
//
// The union row set has THREE row states and they are not interchangeable:
// marked-unallocated (the phase's whole point), marked-allocated (the money),
// and positioned-but-unmarked (money that predates the mark and must never
// vanish). Each carries a DIFFERENT affordance, and one of them carries none.

describe("HoldingsTable — D-12-B render-derived Weight cell", () => {
  /** 120k of a 500k allocated own-capital book — the approved mock's row. */
  function renderApprovedMock() {
    return renderRows({
      strategies: [
        makeMarked({ id: "black-swan", name: "Black Swan" }),
        makeMarked({ id: "arctic-fox", name: "Arctic Fox" }),
      ],
      positions: [
        makeStrategy({ strategy_id: "black-swan", allocated_amount: 120_000 }),
        makeStrategy({ strategy_id: "arctic-fox", allocated_amount: 380_000 }),
      ],
    });
  }

  it("renders the approved mock's `$120,000 · 24.00%` from allocation alone — zero DB write", () => {
    const { container } = renderApprovedMock();
    const row = container.querySelector('[data-strategy-row="black-swan"]')!;
    const cells = [...row.querySelectorAll("td")].map((c) => c.textContent ?? "");
    expect(cells[2]).toBe("24.00%");
    expect(cells[3]).toBe("$120,000");
  });

  it("renders the weight UNSIGNED — a share is not a gain (research delta 4)", () => {
    renderApprovedMock();
    expect(screen.getByText("24.00%")).toBeInTheDocument();
    expect(screen.queryByText("+24.00%")).not.toBeInTheDocument();
    expect(screen.queryByText("+76.00%")).not.toBeInTheDocument();
  });

  it("names the denominator honestly in the Weight column header", () => {
    renderApprovedMock();
    const header = screen.getByRole("columnheader", { name: "Weight" });
    expect(header).toHaveAttribute("title", "share of allocated capital");
  });

  it("renders `—` for a row with no allocation, never a fabricated 0.00%", () => {
    const { container } = renderRows({
      strategies: [makeMarked({ id: "fresh", name: "Fresh Book" })],
      positions: [],
    });
    const row = container.querySelector('[data-strategy-row="fresh"]')!;
    expect(row.querySelectorAll("td")[2].textContent).toBe("—");
  });
});

describe("HoldingsTable — D-12-A union row states", () => {
  function cellsOf(container: HTMLElement, id: string): string[] {
    const row = container.querySelector(`[data-strategy-row="${id}"]`)!;
    return [...row.querySelectorAll("td")].map((c) => c.textContent ?? "");
  }
  function rowOf(container: HTMLElement, id: string): HTMLElement {
    return container.querySelector(
      `[data-strategy-row="${id}"]`,
    ) as HTMLElement;
  }

  it("marked + NOT allocated: `— not allocated`, weight `—`, the tag, and Allocate…", () => {
    const { container } = renderRows({
      strategies: [makeMarked({ id: "fresh", name: "Fresh Book" })],
    });
    const cells = cellsOf(container, "fresh");
    expect(cells[0]).toContain("Fresh Book");
    expect(cells[0]).toContain("Own capital");
    expect(cells[2]).toBe("—");
    // UI-SPEC copy, byte-exact: em-dash in the metric voice, then the caption.
    expect(cells[3]).toBe("— not allocated");
    const row = rowOf(container, "fresh");
    expect(
      within(row).getByRole("button", { name: "Allocate…" }),
    ).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: "Edit allocation…" }),
    ).not.toBeInTheDocument();
  });

  it("marked + allocated: the amount, the derived share, the tag, and Edit allocation…", () => {
    const { container } = renderRows({
      strategies: [makeMarked({ id: "live", name: "Live Book" })],
      positions: [
        makeStrategy({ strategy_id: "live", allocated_amount: 250_000 }),
      ],
    });
    const cells = cellsOf(container, "live");
    expect(cells[0]).toContain("Own capital");
    expect(cells[3]).toBe("$250,000");
    const row = rowOf(container, "live");
    expect(
      within(row).getByRole("button", { name: "Edit allocation…" }),
    ).toBeInTheDocument();
    // D-13's UI half: never both, so a second position can never be minted.
    expect(
      within(row).queryByRole("button", { name: "Allocate…" }),
    ).not.toBeInTheDocument();
  });

  it("positioned but UNMARKED: money still renders, but no tag and no new affordance", () => {
    const { container } = renderRows({
      strategies: [],
      positions: [
        makeStrategy({
          strategy_id: "legacy",
          alias: "Legacy Book",
          allocated_amount: 90_000,
        }),
      ],
    });
    const cells = cellsOf(container, "legacy");
    // D-12-A — allocated money never leaves the money surface.
    expect(cells[3]).toBe("$90,000");
    expect(cells[0]).toContain("Legacy Book");
    expect(cells[0]).not.toContain("Own capital");
    expect(cells[0]).not.toContain("Team review");
    // …but it is NOT in the allocated-own-capital denominator.
    expect(cells[2]).toBe("—");
    const row = rowOf(container, "legacy");
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });

  it("never renders both buttons on one row across a mixed union book", () => {
    const { container } = renderRows({
      strategies: [
        makeMarked({ id: "fresh", name: "Fresh" }),
        makeMarked({ id: "live", name: "Live" }),
      ],
      positions: [
        makeStrategy({ strategy_id: "live", allocated_amount: 10_000 }),
        makeStrategy({ strategy_id: "legacy", allocated_amount: 20_000 }),
      ],
    });
    for (const row of container.querySelectorAll("[data-strategy-row]")) {
      const el = row as HTMLElement;
      const allocate = within(el).queryAllByRole("button", { name: "Allocate…" });
      const edit = within(el).queryAllByRole("button", {
        name: "Edit allocation…",
      });
      expect(allocate.length + edit.length).toBeLessThanOrEqual(1);
    }
  });

  it("dispatches onAllocate / onEditAllocation with the clicked row", () => {
    const onAllocate = vi.fn();
    const onEditAllocation = vi.fn();
    const { container } = renderRows({
      strategies: [
        makeMarked({ id: "fresh", name: "Fresh" }),
        makeMarked({ id: "live", name: "Live" }),
      ],
      positions: [
        makeStrategy({ strategy_id: "live", allocated_amount: 10_000 }),
      ],
      onAllocate,
      onEditAllocation,
    });

    fireEvent.click(
      within(rowOf(container, "fresh")).getByRole("button", {
        name: "Allocate…",
      }),
    );
    expect(onAllocate).toHaveBeenCalledTimes(1);
    expect(onAllocate.mock.calls[0][0]).toMatchObject({
      id: "fresh",
      allocation: null,
    });

    fireEvent.click(
      within(rowOf(container, "live")).getByRole("button", {
        name: "Edit allocation…",
      }),
    );
    expect(onEditAllocation).toHaveBeenCalledTimes(1);
    expect(onEditAllocation.mock.calls[0][0]).toMatchObject({
      id: "live",
      allocation: 10_000,
    });
  });
});

describe("HoldingsTable — D-15 three empty-state arms, in priority order", () => {
  const ARM_2_HEADING = "No strategies marked as own capital.";
  const ARM_2_BODY = "Set the mark from My Strategies, or when you connect a new key.";
  const ARM_2_LINK = "Go to My Strategies →";
  const ARM_3_HEADING = "No strategies yet.";
  const ARM_3_BODY =
    "Connect an exchange API key or upload a CSV to see your strategies here.";

  it("ARM 1 — one or more union rows: the LIST renders and NO empty copy appears", () => {
    // The dead end is dead: the not-allocated row IS the honest state.
    renderRows({
      strategies: [makeMarked({ id: "fresh", name: "Fresh Book" })],
      hasAnyStrategies: true,
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText(ARM_2_HEADING)).not.toBeInTheDocument();
    expect(screen.queryByText(ARM_3_HEADING)).not.toBeInTheDocument();
    // The pre-150 dead end is gone entirely.
    expect(
      screen.queryByText("No strategies onboarded yet."),
    ).not.toBeInTheDocument();
  });

  it("ARM 1 beats ARM 2 even when the marked set is empty but a position exists", () => {
    // Priority is load-bearing: a positioned-but-unmarked row is still a row,
    // so a message claiming nothing is marked would be beside a visible row.
    renderRows({
      positions: [
        makeStrategy({ strategy_id: "legacy", allocated_amount: 5_000 }),
      ],
      hasAnyStrategies: true,
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText(ARM_2_HEADING)).not.toBeInTheDocument();
  });

  it("ARM 2 — zero rows but the user HAS strategies: name the remedy, link to it", () => {
    renderRows({ hasAnyStrategies: true });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(ARM_2_HEADING)).toBeInTheDocument();
    expect(screen.getByText(ARM_2_BODY)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: ARM_2_LINK });
    expect(link).toHaveAttribute("href", "/my-strategies");
    expect(screen.queryByText(ARM_3_HEADING)).not.toBeInTheDocument();
  });

  it("ARM 3 — zero strategies at all: no fabricated promise about allocation", () => {
    renderRows({ hasAnyStrategies: false });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(ARM_3_HEADING)).toBeInTheDocument();
    expect(screen.getByText(ARM_3_BODY)).toBeInTheDocument();
    expect(screen.queryByText(ARM_2_HEADING)).not.toBeInTheDocument();
  });
});

// ══════════════════════════════════ Plan 07 Task 3 — the dialog host, end to end
//
// rev-4 / D-03-B: `MyAllocationDashboardPayload.portfolio` is `Portfolio | null`
// and the overwhelming majority of allocators have NO real book — this route is
// the only `is_test: false` portfolios creation path in the repo (150-05 census).
// The round-3 design answered that with a remedy modal; rev-4 DELETED it unbuilt
// because the allocation route now derives AND lazily provisions the caller's
// portfolio server-side. So the invariant under test is that a null portfolio is
// not a special case at all: `Allocate…` opens the same functional amount dialog
// it opens for everyone, the client sends no container id, and no remedy copy
// exists anywhere in the tree.

describe("HoldingsTabPanel — Allocate… with props.portfolio === null", () => {
  const MARKED_NAME = "Black Swan";

  function renderPanel(
    over: Record<string, unknown> = {},
  ): ReturnType<typeof render> {
    return render(
      <HoldingsTabPanel
        {...({
          portfolio: null,
          analytics: null,
          apiKeys: [],
          alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
          outcomes: [],
          equitySnapshots: [],
          holdingsSummary: [],
          snapshotCount: 0,
          allKeysStale: false,
          lastSyncAt: null,
          hasSyncing: false,
          equityDailyPoints: [],
          minHistoryDepthMonths: null,
          activeVenues: [],
          flaggedHoldings: [],
          matchDecisionsByHoldingRef: {},
          mandate: null,
          strategies: [],
          exposure: EMPTY_EXPOSURE,
          ownCapitalStrategies: [
            makeMarked({ id: "swan", name: MARKED_NAME }),
          ],
          hasAnyStrategies: true,
          ...over,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)}
      />,
    );
  }

  it("opens the AMOUNT dialog — no remedy state, no dead end", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Allocate…" }));

    // The literal title is typed in here, not derived from the component.
    expect(screen.getByText(`Allocate — ${MARKED_NAME}`)).toBeInTheDocument();
    // …and it is FUNCTIONAL, not a shell: the amount field and the CTA are both
    // present and enabled.
    expect(screen.getByLabelText("Allocation (USD)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allocate" })).not.toBeDisabled();
  });

  it("the round-3 remedy copy appears NOWHERE in the rendered tree", () => {
    // The sentinel is ASSEMBLED, not spelled: the plan's acceptance grep runs
    // over this directory, and a literal here would match the very test that
    // exists to prove the string is gone (the 140.2-08 / 150-02
    // self-matching-comment lesson). The assembled value is byte-identical.
    const REMEDY_SENTINEL = ["No", "portfolio", "yet."].join(" ");
    const { container } = renderPanel();
    expect(container.textContent).not.toContain(REMEDY_SENTINEL);
    fireEvent.click(screen.getByRole("button", { name: "Allocate…" }));
    expect(container.textContent).not.toContain(REMEDY_SENTINEL);
  });

  it("feeds the adapter BOTH union halves explicitly (B-3 hand-off closed)", () => {
    // The marked strategy has no position, so it can only reach the table via
    // the `strategies` half. A panel that still passed one argument would show
    // an empty table here.
    renderPanel();
    const row = document.querySelector('[data-strategy-row="swan"]');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("not allocated")).toBeInTheDocument();
  });

  it("threads the D-15 discriminator, so an owner WITH strategies is never told they have none", () => {
    // The panel is the only place `hasAnyStrategies` is sourced from real data.
    // If it stops threading the prop, HoldingsTable's conservative `?? false`
    // default fires ARM 3 — telling an allocator who HAS strategies that they
    // have none, and pointing them at the wrong remedy.
    renderPanel({ ownCapitalStrategies: [], hasAnyStrategies: true });
    expect(
      screen.getByText("No strategies marked as own capital."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No strategies yet.")).not.toBeInTheDocument();
  });
});
