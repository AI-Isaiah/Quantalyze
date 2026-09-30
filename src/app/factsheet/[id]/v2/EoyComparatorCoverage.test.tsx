/** @vitest-environment jsdom */
/**
 * Phase 169.5 plan 04 (SC3, D-09, D-21, D-64): a day the comparator has no price
 * for never enters an end-of-year comparator figure as a 0% day.
 *
 * Why this matters: the EoY table (MetricsColumn `EoyReturnsPanel`) and the EoY
 * bars (DistributionPanels `EndOfYearBarsPanel`) compound the comparator's
 * per-day `dailyReturns`. If an uncovered day is entered as 0, a calendar year the
 * comparator has NO price for reads "+0.00%" beside the strategy's real return: a
 * flat BTC year that never happened, printed as a fact on an investment document.
 * The honest reading is the panels' own missing-value form (the table's em-dash,
 * no bar and no label in the bars).
 *
 * Every figure below is computed by hand from the typed closes (close = 100 + i on
 * the i-th consecutive calendar day of the price series), never from project code.
 *
 * D-64 (founder ruling 2026-09-27, 166.4 D-05): index 0 is the comparator's own
 * return dated the strategy's first date when a close before it exists, and null
 * when none does. The null half is asserted on `dailyReturns[0]` directly, in its
 * own `expect`: compounding (1 + 0) equals skipping, so an EoY-level figure cannot
 * tell a 0 from a skip.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { buildComparatorBlock } from "@/lib/factsheet/comparator-block";
import { alignCoveredReturns } from "@/lib/factsheet/align";
import { cumEq } from "@/lib/factsheet/compute";
import type { DailyPrice, FactsheetPayload } from "@/lib/factsheet/types";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";
import { EndOfYearBarsPanel } from "./DistributionPanels";

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
function days(a: string, b: string): string[] {
  const o: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) o.push(d);
  return o;
}

/** Closes on consecutive calendar days from `start` to `end`: close = 100 + i. */
function closes(start: string, end: string): DailyPrice[] {
  return days(start, end).map((date, i) => ({ date, close: 100 + i }));
}

/** A 7-day strategy over two calendar years: 12 days of 2024, 31 of 2025. */
const DATES = days("2024-12-20", "2025-01-31");
const STRAT = DATES.map((_, i) => ((i % 5) - 2) / 1000);

const STRATEGY = {
  id: "s-169-5-04",
  name: "EoY Coverage Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

function payloadWith(prices: DailyPrice[]): FactsheetPayload {
  const p = buildFactsheetPayload(
    STRATEGY,
    DATES.map((date, i) => ({ date, value: STRAT[i] })),
    { benchmarkPrices: { prices, through: prices[prices.length - 1]?.date ?? null, dropped: [] } },
  );
  if (!p) throw new Error("fixture must build");
  return { ...p, activeComparator: "btc" };
}

/** The EoY table's BTC cell for `year`. */
function tableBtc(payload: FactsheetPayload, year: string): string {
  const { getAllByText, unmount } = render(
    <FactsheetProvider payload={payload}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
  const heading = getAllByText("EOY Returns", { selector: "h3" })[0];
  const section = heading.closest("section") as HTMLElement;
  const row = [...section.querySelectorAll("tbody tr")].find(tr => tr.querySelector("td")?.textContent === year);
  if (!row) throw new Error(`no ${year} row in the EoY table`);
  const out = row.querySelectorAll("td")[2]?.textContent ?? "";
  unmount();
  return out;
}

/** The EoY bars' row for `year`: its value labels and its bar count. */
function barsRow(payload: FactsheetPayload, year: string): { labels: string[]; bars: number } {
  const { container, unmount } = render(
    <FactsheetProvider payload={payload}>
      <EndOfYearBarsPanel />
    </FactsheetProvider>,
  );
  const g = [...container.querySelectorAll("g")].find(el => el.querySelector("text")?.textContent === year);
  if (!g) throw new Error(`no ${year} row in the EoY bars`);
  const out = {
    labels: [...g.querySelectorAll("text")].slice(1).map(t => t.textContent ?? ""),
    bars: g.querySelectorAll("rect").length,
  };
  unmount();
  return out;
}

describe("169.5-04 comparator dailyReturns: null wherever the comparator has no return", () => {
  it("prices ending 10 days before the strategy: the last 10 days are null, the rest the helper's series", () => {
    const p = closes("2024-12-19", "2025-01-21");
    const a = alignCoveredReturns(p, [], DATES);
    const b = buildComparatorBlock("BTC-USD", "BTC", a, STRAT, cumEq(STRAT), DATES, 0.2, 5, 5, 365, 365);
    expect(b.dailyReturns).toEqual(a.returns);
    expect(b.dailyReturns!.slice(-10)).toEqual(Array(10).fill(null));
    expect(b.dailyReturns!.slice(0, -10).every(r => typeof r === "number")).toBe(true);
    // D-64: day one is BTC's own return dated the first strategy date, 101 / 100 - 1.
    expect(b.dailyReturns![0]).toBeCloseTo(0.01, 12);
  });

  it("no close before the first strategy date: dailyReturns[0] is null, never 0 (D-64)", () => {
    const a = alignCoveredReturns(closes("2024-12-20", "2025-01-31"), [], DATES);
    const b = buildComparatorBlock("BTC-USD", "BTC", a, STRAT, cumEq(STRAT), DATES, 0.2, 5, 5, 365, 365);
    expect(b.dailyReturns![0]).toBeNull();
  });

  it("a dropped close leaves its day null, never 0; the next day keeps its series value (D-58)", () => {
    const p = closes("2024-12-19", "2025-01-31");
    const a = alignCoveredReturns(p, ["2025-01-10"], DATES);
    const b = buildComparatorBlock("BTC-USD", "BTC", a, STRAT, cumEq(STRAT), DATES, 0.2, 5, 5, 365, 365);
    const i = DATES.indexOf("2025-01-10");
    expect(b.dailyReturns![i]).toBeNull();
    expect(b.dailyReturns).toEqual(a.returns);
    expect(typeof b.dailyReturns![i + 1]).toBe("number");
  });

  it("full coverage: no null anywhere", () => {
    const p = payloadWith(closes("2024-12-19", "2025-01-31"));
    expect(p.comparators.btc.dailyReturns!.every(r => typeof r === "number")).toBe(true);
    expect(p.comparators.btc.dailyReturns!.length).toBe(DATES.length);
  });
});

describe("169.5-04 EoY table and bars: a year with no covered comparator day is missing, not +0.00%", () => {
  // BTC closes start 2025-01-05: no 2024 day is covered.
  const late = () => payloadWith(closes("2025-01-05", "2025-01-31"));

  it("the EoY table shows the em-dash for 2024, not +0.00%", () => {
    expect(tableBtc(late(), "2024")).toBe("—");
  });

  it("the EoY bars draw no BTC bar and no BTC label for 2024", () => {
    const row = barsRow(late(), "2024");
    expect(row.labels).toHaveLength(1); // the strategy's own label only
    expect(row.bars).toBe(1); // the strategy's own bar only
  });

  it("the covered year still reads its figure: 2025 = close(01-31) / close(01-05) - 1 = 126 / 100 - 1", () => {
    expect(tableBtc(late(), "2025")).toBe("+26.00%");
    expect(barsRow(late(), "2025").labels[1]).toBe("+26.0%");
  });
});

describe("169.5-04 EoY figures compound covered days only, day one included (D-64)", () => {
  // Closes from 2024-12-19 (the day before day one) to 2025-01-20 (11 days before the
  // end; 01-20 rather than 01-21 keeps the last-year figure off a rounding boundary:
  // 133 / 112 - 1 is 18.75%, which a one-decimal label may print either way).
  const partial = () => payloadWith(closes("2024-12-19", "2025-01-20"));

  it("the first year compounds day one: 2024 = close(12-31) / close(12-19) - 1 = 112 / 100 - 1", () => {
    expect(tableBtc(partial(), "2024")).toBe("+12.00%");
    expect(barsRow(partial(), "2024").labels[1]).toBe("+12.0%");
  });

  it("the last year is over its covered days only: 2025 = close(01-20) / close(12-31) - 1 = 132 / 112 - 1", () => {
    expect(tableBtc(partial(), "2025")).toBe("+17.86%");
    expect(barsRow(partial(), "2025").labels[1]).toBe("+17.9%");
  });
});
