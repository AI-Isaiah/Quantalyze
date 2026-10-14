/** @vitest-environment jsdom */
/**
 * Phase 170.6 DISPLAYPOLISH plan 03 (D-02, D-03, D-04, D-05): the factsheet metrics rail
 * prints a value that rounds to zero unsigned and neutral, and colours every figure from
 * the sign of the ROUNDED printed value, never the raw one.
 *
 * Why this matters: before this plan the rail's own private `pct` / `pctNeg` / `signed` /
 * `num` printed `-0.00` and `+0.00%` for a value that rounds to zero, Best / Worst was
 * painted green / red by POSITION (a positive worst week was red), the EoY cells were
 * painted red when the cell read "—" (a null is not a loss), and the Worst Drawdowns
 * depth was red regardless of its value.
 *
 * Every expectation is a hand-typed string. The payload is built by the real builder and
 * the specific fields are then overwritten, so each cell receives a raw value that rounds
 * to zero at the precision it prints at.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { DailyPrice, FactsheetPayload } from "@/lib/factsheet/types";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
function days(a: string, b: string): string[] {
  const o: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) o.push(d);
  return o;
}

const DATES = days("2024-12-20", "2025-01-31");
const STRAT = DATES.map((_, i) => ((i % 5) - 2) / 1000);
const PRICES: DailyPrice[] = days("2024-12-19", "2025-01-31").map((date, i) => ({ date, close: 100 + i }));

const STRATEGY = {
  id: "s-170-6-p03",
  name: "Signed Zero Rail Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

const POS = "var(--color-positive)";
const NEG = "var(--color-negative)";

function basePayload(): FactsheetPayload {
  const p = buildFactsheetPayload(
    STRATEGY,
    DATES.map((date, i) => ({ date, value: STRAT[i] })),
    { benchmarkPrices: { prices: PRICES, through: PRICES[PRICES.length - 1].date, dropped: [] } },
  );
  if (!p) throw new Error("fixture must build");
  return { ...p, activeComparator: "btc" };
}

/** The base payload with chosen strategy scalars overwritten. */
function withMetrics(over: Record<string, unknown>): FactsheetPayload {
  const p = basePayload();
  return { ...p, strategyMetrics: { ...p.strategyMetrics, ...over } as FactsheetPayload["strategyMetrics"] };
}

/** The base payload with every comparator daily return forced to 0 (so a bench year compounds to 0). */
function withFlatBench(yearly: Record<string, number>): FactsheetPayload {
  const p = withMetrics({ yearly });
  const btc = p.comparators.btc;
  return {
    ...p,
    comparators: {
      ...p.comparators,
      btc: { ...btc, dailyReturns: DATES.map(() => 0) },
    } as FactsheetPayload["comparators"],
  };
}

function renderRail(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

function panel(container: HTMLElement, title: string): HTMLElement {
  const h = [...container.querySelectorAll("h3")].find(el => el.textContent === title);
  if (!h) throw new Error(`no ${title} panel`);
  return h.closest("section") as HTMLElement;
}

/** The cells of the row whose first cell reads `label` (case-sensitive textContent). */
function rowCells(root: HTMLElement, label: string): HTMLElement[] {
  const tr = [...root.querySelectorAll("tr")].find(r => r.querySelector("td")?.textContent === label);
  if (!tr) throw new Error(`no row ${label}`);
  return [...tr.querySelectorAll("td")] as HTMLElement[];
}

describe("MetricsColumn 170.6 D-02: a rounded zero prints unsigned in Main Metrics and Max Drawdown", () => {
  it("Sharpe -0.004 reads 0.00, Skew -0.004 reads 0.00, CAGR 0 reads 0.00%, Max Drawdown -0.00004 reads 0.00%", () => {
    const { container, unmount } = renderRail(
      withMetrics({ sharpe: -0.004, skew: -0.004, cagr: 0, max_dd: -0.00004 }),
    );
    const main = panel(container, "Main Metrics");
    expect(rowCells(main, "Sharpe")[1].textContent).toBe("0.00");
    expect(rowCells(main, "CAGR")[1].textContent).toBe("0.00%");
    expect(rowCells(panel(container, "Max Drawdown"), "Max Drawdown")[1].textContent).toBe("0.00%");
    // Skew is printed in Main Metrics and again in Extended Metrics, both by this file's formatter.
    expect(rowCells(main, "Skew")[1].textContent).toBe("0.00");
    expect(rowCells(panel(container, "Extended Metrics"), "Skew")[1].textContent).toBe("0.00");
    unmount();
  });

  it("a non-zero figure keeps its digits and sign: Sharpe 1.234 reads 1.23, Skew -0.5 reads -0.50, CAGR 0.05 reads +5.00%", () => {
    const { container, unmount } = renderRail(withMetrics({ sharpe: 1.234, skew: -0.5, cagr: 0.05 }));
    const main = panel(container, "Main Metrics");
    expect(rowCells(main, "Sharpe")[1].textContent).toBe("1.23");
    expect(rowCells(main, "CAGR")[1].textContent).toBe("+5.00%");
    expect(rowCells(main, "Skew")[1].textContent).toBe("-0.50");
    expect(rowCells(panel(container, "Extended Metrics"), "Skew")[1].textContent).toBe("-0.50");
    unmount();
  });
});

describe("MetricsColumn 170.6 D-02 + D-03: the EoY table", () => {
  it("a strategy year of -0.00004 reads 0.00% with no colour; a bench year of 0 reads 0.00% with no colour; their delta reads 0.0pp with no colour", () => {
    const { container, unmount } = renderRail(withFlatBench({ "2024": -0.00004, "2025": 0.0123 }));
    const eoy = panel(container, "EOY Returns");
    const [, s, b, d] = rowCells(eoy, "2024");
    expect(s.textContent).toBe("0.00%");
    expect(b.textContent).toBe("0.00%");
    expect(d.textContent).toBe("0.0pp");
    for (const cell of [s, b, d]) expect(cell.getAttribute("style") ?? "").not.toContain("--color-");
    unmount();
  });

  it("a delta of 0.0123 reads +1.2pp in --color-positive, beside a positive strategy cell", () => {
    const { container, unmount } = renderRail(withFlatBench({ "2024": -0.00004, "2025": 0.0123 }));
    const [, s, b, d] = rowCells(panel(container, "EOY Returns"), "2025");
    expect(s.textContent).toBe("+1.23%");
    expect(s.style.color).toBe(POS);
    expect(b.textContent).toBe("0.00%");
    expect(d.textContent).toBe("+1.2pp");
    expect(d.style.color).toBe(POS);
    unmount();
  });

  it("a delta of +0.0004 reads 0.0pp with no colour while its strategy cell reads +0.04% in --color-positive", () => {
    const { container, unmount } = renderRail(withFlatBench({ "2024": 0.0004, "2025": -0.2 }));
    const eoy = panel(container, "EOY Returns");
    const [, s24, , d24] = rowCells(eoy, "2024");
    expect(s24.textContent).toBe("+0.04%");
    expect(s24.style.color).toBe(POS);
    expect(d24.textContent).toBe("0.0pp");
    expect(d24.getAttribute("style") ?? "").not.toContain("--color-");
    const [, s25, , d25] = rowCells(eoy, "2025");
    expect(s25.textContent).toBe("-20.00%");
    expect(s25.style.color).toBe(NEG);
    expect(d25.textContent).toBe("-20.0pp");
    expect(d25.style.color).toBe(NEG);
    unmount();
  });

  it("a year the comparator does not cover reads — with no colour (today it is red)", () => {
    const { container, unmount } = renderRail(withFlatBench({ "2023": 0.05, "2025": 0.01 }));
    const [, s, b, d] = rowCells(panel(container, "EOY Returns"), "2023");
    expect(s.textContent).toBe("+5.00%");
    expect(b.textContent).toBe("—");
    expect(d.textContent).toBe("—");
    expect(b.getAttribute("style") ?? "").not.toContain("--color-");
    expect(d.getAttribute("style") ?? "").not.toContain("--color-");
    unmount();
  });
});

describe("MetricsColumn 170.6 D-03: Best / Worst take their colour from the rounded sign", () => {
  const bw = (over: Record<string, unknown>) => {
    const { container, unmount } = renderRail(withMetrics(over));
    const cells = (scale: string) => rowCells(panel(container, "Best / Worst Period"), scale);
    return { cells, unmount };
  };

  it("a worst week of +0.012 reads +1.20% in --color-positive (today red)", () => {
    const { cells, unmount } = bw({ best_week: 0.03, worst_week: 0.012 });
    const [, best, worst] = cells("Week");
    expect(best.textContent).toBe("+3.00%");
    expect(best.style.color).toBe(POS);
    expect(worst.textContent).toBe("+1.20%");
    expect(worst.style.color).toBe(POS);
    unmount();
  });

  it("a worst day of -0.00004 reads 0.00% with no colour; a best day of -0.003 reads -0.30% in --color-negative", () => {
    const { cells, unmount } = bw({ best_day: -0.003, worst_day: -0.00004 });
    const [, best, worst] = cells("Day");
    expect(best.textContent).toBe("-0.30%");
    expect(best.style.color).toBe(NEG);
    expect(worst.textContent).toBe("0.00%");
    expect(worst.getAttribute("style") ?? "").not.toContain("--color-");
    unmount();
  });

  it("an ordinary best +4% stays green and an ordinary worst -2% stays red", () => {
    const { cells, unmount } = bw({ best_month: 0.04, worst_month: -0.02 });
    const [, best, worst] = cells("Month");
    expect(best.textContent).toBe("+4.00%");
    expect(best.style.color).toBe(POS);
    expect(worst.textContent).toBe("-2.00%");
    expect(worst.style.color).toBe(NEG);
    unmount();
  });
});

describe("MetricsColumn 170.6 D-02 + D-04: the Worst Drawdowns depth", () => {
  const withDepths = (depths: number[]): FactsheetPayload => ({
    ...basePayload(),
    strategyWorst10: depths.map((depth, i) => ({ start: 1 + i * 4, trough: 2 + i * 4, recover: 3 + i * 4, depth })),
  });
  const depthCells = (container: HTMLElement): HTMLElement[] =>
    [...panel(container, "Worst 10 Drawdowns").querySelectorAll("tbody tr")].map(
      tr => tr.querySelectorAll("td")[4] as HTMLElement,
    );

  it("a depth of -0.00004 reads 0.00% with no --color-negative style; -0.0342 reads -3.42% in --color-negative", () => {
    const { container, unmount } = renderRail(withDepths([-0.00004, -0.0342]));
    const [zero, deep] = depthCells(container);
    expect(zero.textContent).toBe("0.00%");
    expect(zero.getAttribute("style") ?? "").not.toContain("--color-");
    expect(deep.textContent).toBe("-3.42%");
    expect(deep.style.color).toBe(NEG);
    unmount();
  });

  it("no depth is ever --color-positive, even a positive one a corrupt payload carries", () => {
    const { container, unmount } = renderRail(withDepths([0.02, -0.0342]));
    for (const cell of depthCells(container)) expect(cell.getAttribute("style") ?? "").not.toContain(POS);
    unmount();
  });
});
