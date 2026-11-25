import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HoldingsTable } from "./HoldingsTable";
import { toStrategyRows } from "../lib/strategies-row-adapter";
import {
  shortTrackMarkerTitle,
  withheldCellTitle,
} from "@/lib/figure-gate";
import type { OwnCapitalStrategy } from "@/lib/queries";

/**
 * Phase 194 plan 11 (D-04 as superseded by D-15) — the Sharpe column users see on
 * Holdings follows the same total-record rule as every other page.
 *
 * WHY THIS MATTERS: this is the table an allocator reads next to their own money. A
 * Sharpe annualised from a few weeks of returns is noise that looks like a result, so a
 * strategy whose TOTAL record is under D-15's minimum prints a toneless dash with the
 * reason, and a cleared record under a year carries the `<1y` marker. The cases run the
 * REAL adapter into the REAL table: the gate is in the adapter, the rendering is here,
 * and a regression in either shows up as a wrong cell a human would read.
 */

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

const NOW = new Date("2026-06-02T00:00:00Z");

function marked(over: {
  id: string;
  sharpe: number | null;
  span: number | null;
  crypto?: boolean;
  observations?: number | null;
  mtd?: number | null;
  maxDd?: number | null;
  withheldBy?: "options_cash_wallet" | null;
}): OwnCapitalStrategy {
  return {
    id: over.id,
    name: over.id,
    codename: null,
    disclosure_tier: "exploratory",
    status: "private",
    capital_ownership: "own_capital",
    mtd: over.mtd ?? null,
    figure_span_days: over.span,
    figure_observations: over.observations ?? null,
    figure_crypto: over.crypto ?? true,
    figure_unreadable: false,
    figure_withheld_by: over.withheldBy ?? null,
    strategy_analytics: {
      cagr: null,
      sharpe: over.sharpe,
      volatility: null,
      max_drawdown: over.maxDd ?? null,
    },
  };
}

function renderStrategies(strategies: OwnCapitalStrategy[]) {
  return render(
    <HoldingsTable
      strategyRows={toStrategyRows({ strategies, positions: [], now: NOW })}
      hasAnyStrategies
    />,
  );
}

/** The Sharpe `<td>` of a row: [Strategy, Manager, Weight, Allocation, MTD, Sharpe, Max DD, Age, Actions]. */
function sharpeCell(container: HTMLElement, id: string): HTMLElement {
  const row = container.querySelector(`[data-strategy-row="${id}"]`)!;
  return row.querySelectorAll("td")[5] as HTMLElement;
}

describe("HoldingsTable StrategyRowsTable: MTD and Max DD of an options book (252 WR-01)", () => {
  const cell = (container: HTMLElement, id: string, index: number) =>
    container.querySelector(`[data-strategy-row="${id}"]`)!.querySelectorAll("td")[index] as HTMLElement;

  it("a flagged row withholds MTD and Max DD with the named sentence, as it does its Sharpe; the same row unflagged shows both figures", () => {
    const { container } = renderStrategies([
      marked({ id: "flagged", sharpe: 1.8, span: 400, mtd: 0.07, maxDd: -0.12, withheldBy: "options_cash_wallet" }),
      marked({ id: "plain", sharpe: 1.8, span: 400, mtd: 0.07, maxDd: -0.12 }),
    ]);
    const reason = withheldCellTitle({
      spanDays: 400,
      observations: null,
      crypto: true,
      withheldBy: "options_cash_wallet",
    });
    expect(reason).toMatch(/cash wallet/);
    for (const index of [4, 6]) {
      const flagged = cell(container, "flagged", index);
      expect(flagged.textContent?.startsWith("—")).toBe(true);
      expect(flagged.textContent).not.toMatch(/7\.0|12\.0|0\.07|0\.12/);
      expect(flagged.querySelector(`[title="${reason}"]`), "the reason is the cell's title").not.toBeNull();
      expect(flagged.querySelector(".sr-only")?.textContent).toBe(reason);
    }
    expect(cell(container, "plain", 4).textContent).toContain("7.0");
    expect(cell(container, "plain", 6).textContent).toContain("12.0");
    expect(cell(container, "plain", 4).querySelector("[title]")).toBeNull();
    expect(cell(container, "plain", 6).querySelector("[title]")).toBeNull();
  });
});

describe("HoldingsTable StrategyRowsTable: Sharpe cell (194 D-04 / D-15)", () => {
  it("a withheld row prints a toneless dash, the reason as title, and the same reason as sr-only text", () => {
    const { container } = renderStrategies([marked({ id: "w", sharpe: 1.8, span: 60 })]);
    const cell = sharpeCell(container, "w");
    const reason = withheldCellTitle({ spanDays: 60, observations: null, crypto: true });

    // The stored 1.80 is NOT on the page.
    expect(cell.textContent).not.toContain("1.80");
    expect(cell.textContent?.startsWith("—")).toBe(true);
    const titled = cell.querySelector(`[title="${reason}"]`);
    expect(titled, "the reason must be the cell's title").not.toBeNull();
    expect(cell.querySelector(".sr-only")?.textContent).toBe(reason);
    // D-05: a withheld figure carries no tone.
    expect(cell.className).not.toMatch(/text-(positive|negative)/);
    expect(cell.innerHTML).not.toMatch(/text-(positive|negative)/);
  });

  it("a non-crypto row under 60 observations is withheld with the trading-day reason", () => {
    const { container } = renderStrategies([
      marked({ id: "n", sharpe: 1.1, span: 120, crypto: false, observations: 59 }),
    ]);
    const cell = sharpeCell(container, "n");
    expect(cell.textContent).not.toContain("1.10");
    expect(cell.querySelector(".sr-only")?.textContent).toBe(
      withheldCellTitle({ spanDays: 120, observations: 59, crypto: false }),
    );
  });

  it("a short row (cleared record under one year) shows the stored Sharpe followed by <1y with its reason", () => {
    const { container } = renderStrategies([marked({ id: "s", sharpe: 1.8, span: 200 })]);
    const cell = sharpeCell(container, "s");
    const reason = shortTrackMarkerTitle(200);

    expect(cell.textContent).toContain("1.80");
    const marker = cell.querySelector(`[title="${reason}"]`) as HTMLElement | null;
    expect(marker, "the <1y marker").not.toBeNull();
    expect(marker!.textContent).toContain("<1y");
    expect(marker!.querySelector(".sr-only")?.textContent).toBe(` ${reason}`);
    expect(marker!.className).toContain("text-text-muted");
  });

  it("full (a year or more) and null (record undeterminable) rows are unchanged: the figure alone, no marker, no title", () => {
    const { container } = renderStrategies([
      marked({ id: "f", sharpe: 1.8, span: 400 }),
      marked({ id: "u", sharpe: 2.2, span: null }),
    ]);
    for (const [id, text] of [
      ["f", "1.80"],
      ["u", "2.20"],
    ] as const) {
      const cell = sharpeCell(container, id);
      expect(cell.textContent).toBe(text);
      expect(cell.querySelector("[title]")).toBeNull();
      expect(cell.querySelector(".sr-only")).toBeNull();
    }
  });

  it("a withheld row sorts after every finite Sharpe in BOTH directions (it is null, never a 0)", () => {
    const { container } = renderStrategies([
      marked({ id: "withheld", sharpe: 9.9, span: 30 }),
      marked({ id: "neg", sharpe: -0.5, span: 400 }),
      marked({ id: "pos", sharpe: 1.5, span: 400 }),
    ]);
    const ids = () =>
      [...container.querySelectorAll("[data-strategy-row]")].map((r) =>
        r.getAttribute("data-strategy-row"),
      );

    // First click: descending. The withheld row's stored 9.9 would win if it leaked.
    fireEvent.click(screen.getByRole("button", { name: "Sharpe" }));
    expect(ids()).toEqual(["pos", "neg", "withheld"]);
    // Second click: ascending. Still last; a zero substitute would put it between -0.5 and 1.5.
    fireEvent.click(screen.getByRole("button", { name: "Sharpe" }));
    expect(ids()).toEqual(["neg", "pos", "withheld"]);
  });
});
