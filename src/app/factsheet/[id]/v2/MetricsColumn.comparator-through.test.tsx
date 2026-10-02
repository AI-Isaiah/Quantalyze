/** @vitest-environment jsdom */
/**
 * Phase 169.5 review round 1, SFH-M-05 (keeps D-54): when the comparator's prices
 * stop before the strategy's last date, the figures measured over its covered
 * days only are dated NEXT TO the numbers.
 *
 * Why this matters: D-54 measures a comparator over its covered days, so with BTC
 * stored through Jan 20 and the strategy running to Jan 31, Main Metrics prints
 * the strategy's full-span Cumulative Return and CAGR beside BTC's shorter-span
 * ones under one "vs BTC" header, and the EoY current-year BTC cell is a
 * part-year compound, while the Year-to-date BTC cell two panels up is "—". The
 * only disclosure was the picker caption, away from the rows it qualifies. A
 * reader comparing the two columns must see, on the column, that BTC's figures
 * stop at Jan 20.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { DailyPrice, FactsheetPayload } from "@/lib/factsheet/types";
import { CALENDAR_7D, CALENDAR_WEEKDAY } from "@/lib/factsheet/align";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn, comparatorPartialThrough, comparatorPartialYear } from "./MetricsColumn";
import { EndOfYearBarsPanel } from "./DistributionPanels";

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
function days(a: string, b: string): string[] {
  const o: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) o.push(d);
  return o;
}
function closes(start: string, end: string): DailyPrice[] {
  return days(start, end).map((date, i) => ({ date, close: 100 + i }));
}

/** A 7-day strategy: 12 days of 2024, 31 of 2025. */
const DATES = days("2024-12-20", "2025-01-31");
const STRAT = DATES.map((_, i) => ((i % 5) - 2) / 1000);

const STRATEGY = {
  id: "s-169-5-sfh-m-05",
  name: "Comparator Through Fixture",
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

/** The text of a panel's `vs …` bench header ("" when the panel has none). */
function benchHeader(container: HTMLElement, title: string): string {
  const h = [...container.querySelectorAll("h3")].find(el => el.textContent === title);
  if (!h) throw new Error(`no ${title} panel`);
  const span = h.closest("header")?.querySelector("span");
  return span?.textContent ?? "";
}

function renderRail(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

function barsSubtitle(payload: FactsheetPayload): string {
  const { container, unmount } = render(
    <FactsheetProvider payload={payload} persist={false}>
      <EndOfYearBarsPanel />
    </FactsheetProvider>,
  );
  const out = container.querySelector("figure header p")?.textContent ?? "";
  unmount();
  return out;
}

describe("SFH-M-05 a partly covered comparator is dated beside its figures", () => {
  const partial = () => payloadWith(closes("2024-12-19", "2025-01-20"));
  const full = () => payloadWith(closes("2024-12-19", "2025-01-31"));

  it("precondition: BTC's through is Jan 20, before the strategy's Jan 31", () => {
    expect(partial().comparators.btc.through).toBe("2025-01-20");
    expect(full().comparators.btc.through).toBe("2025-01-31");
  });

  it("Main Metrics, Returns and Max Drawdown carry 'vs BTC to Jan 20, 2025'", () => {
    const { container, unmount } = renderRail(partial());
    expect(benchHeader(container, "Main Metrics")).toBe("vs BTC to Jan 20, 2025");
    expect(benchHeader(container, "Returns")).toBe("vs BTC to Jan 20, 2025");
    expect(benchHeader(container, "Max Drawdown")).toBe("vs BTC to Jan 20, 2025");
    unmount();
  });

  it("the EoY table names the part-covered year and its through date", () => {
    const { container, unmount } = renderRail(partial());
    const h = [...container.querySelectorAll("h3")].find(el => el.textContent === "EOY Returns")!;
    const note = h.closest("section")!.querySelector("p");
    expect(note?.textContent).toBe("BTC 2025: prices through Jan 20, 2025 only.");
    unmount();
  });

  it("the EoY bars subtitle names the part-covered year and its through date", () => {
    expect(barsSubtitle(partial())).toContain("BTC 2025 through Jan 20, 2025 only");
  });

  it("full coverage: every header and caption is as before (no date, no note)", () => {
    const { container, unmount } = renderRail(full());
    expect(benchHeader(container, "Main Metrics")).toBe("vs BTC");
    expect(benchHeader(container, "Returns")).toBe("vs BTC");
    expect(benchHeader(container, "Max Drawdown")).toBe("");
    const h = [...container.querySelectorAll("h3")].find(el => el.textContent === "EOY Returns")!;
    expect(h.closest("section")!.querySelector("p")).toBeNull();
    unmount();
    expect(barsSubtitle(full())).not.toContain("through");
  });
});

describe("SFH-M-05 helpers", () => {
  it("comparatorPartialThrough: dated only when a day of the comparator's calendar lies after through", () => {
    expect(comparatorPartialThrough("2025-01-20", "2025-01-31", CALENDAR_7D)).toBe("2025-01-20");
    expect(comparatorPartialThrough("2025-01-31", "2025-01-31", CALENDAR_7D)).toBeNull();
    expect(comparatorPartialThrough(null, "2025-01-31", CALENDAR_7D)).toBeNull(); // unavailable: figures already "—"
    expect(comparatorPartialThrough(undefined, "2025-01-31", CALENDAR_7D)).toBeNull(); // hand-built block, D-21
  });

  it("comparatorPartialYear: null when through closes its year (the next year already reads '—')", () => {
    expect(comparatorPartialYear("2025-01-20", DATES, CALENDAR_7D)).toBe("2025");
    expect(comparatorPartialYear("2024-12-31", DATES, CALENDAR_7D)).toBeNull();
  });
});

/**
 * Phase 169.5 review round 2, MR-01 = SFH-R2-M-01: "partial" is read on the
 * comparator's OWN calendar, the rule the windows (`buildComparatorBlock`'s
 * `pastThrough`) and the picker caption use.
 *
 * Why this matters: SPX never closes on a weekend. With a 7-day strategy ending
 * Sunday and SPX through the Friday before, nothing is missing: the caption is
 * silent and every SPX window is a number. A raw `through < lastDate` rule dated
 * the headers "vs SPX to Mar 14" and printed "prices through Mar 14 only" under
 * the EoY table, telling an allocator SPX data is missing where its record is
 * complete, and contradicting the caption on the same page.
 */
describe("MR-01 a weekday comparator is not partial across the strategy's weekend", () => {
  /** A 7-day strategy ending Sunday 2025-03-16, inside the SPX fixture's range. */
  const WEEKEND_DATES = days("2025-01-01", "2025-03-16");

  function spxPayload(spxThrough?: string): FactsheetPayload {
    const p = buildFactsheetPayload(
      STRATEGY,
      WEEKEND_DATES.map((date, i) => ({ date, value: ((i % 5) - 2) / 1000 })),
      { benchmarkPrices: { prices: closes("2024-12-31", "2025-03-16"), through: "2025-03-16", dropped: [] } },
    );
    if (!p) throw new Error("fixture must build");
    const spx = spxThrough === undefined ? p.comparators.spx : { ...p.comparators.spx, through: spxThrough };
    return { ...p, comparators: { ...p.comparators, spx }, activeComparator: "spx" };
  }

  function eoyNote(container: HTMLElement): HTMLParagraphElement | null {
    const h = [...container.querySelectorAll("h3")].find(el => el.textContent === "EOY Returns")!;
    return h.closest("section")!.querySelector("p");
  }

  it("precondition: SPX's Friday close is its through, and its windows are numbers", () => {
    const p = spxPayload();
    expect(p.comparators.spx.through).toBe("2025-03-14");
    expect(typeof p.comparators.spx.summary!.mtd).toBe("number");
  });

  it("SPX through Fri 2025-03-14, strategy through Sun 2025-03-16: no dated header, no EoY note", () => {
    const p = spxPayload();
    const { container, unmount } = renderRail(p);
    expect(benchHeader(container, "Main Metrics")).toBe("vs SPX");
    expect(benchHeader(container, "Returns")).toBe("vs SPX");
    expect(benchHeader(container, "Max Drawdown")).toBe("");
    expect(eoyNote(container)).toBeNull();
    unmount();
    expect(barsSubtitle(p)).not.toContain("through");
  });

  it("control: SPX through Wed 2025-03-12 (Thu and Fri missing) is dated everywhere", () => {
    const p = spxPayload("2025-03-12");
    const { container, unmount } = renderRail(p);
    expect(benchHeader(container, "Main Metrics")).toBe("vs SPX to Mar 12, 2025");
    expect(benchHeader(container, "Returns")).toBe("vs SPX to Mar 12, 2025");
    expect(benchHeader(container, "Max Drawdown")).toBe("vs SPX to Mar 12, 2025");
    expect(eoyNote(container)?.textContent).toBe("SPX 2025: prices through Mar 12, 2025 only.");
    unmount();
    expect(barsSubtitle(p)).toContain("SPX 2025 through Mar 12, 2025 only");
  });

  it("helpers: the weekend is past a 7-day comparator's coverage and not a weekday one's", () => {
    expect(comparatorPartialThrough("2025-03-14", "2025-03-16", CALENDAR_WEEKDAY)).toBeNull();
    expect(comparatorPartialThrough("2025-03-14", "2025-03-16", CALENDAR_7D)).toBe("2025-03-14");
    expect(comparatorPartialThrough("2025-03-12", "2025-03-16", CALENDAR_WEEKDAY)).toBe("2025-03-12");
  });

  it("comparatorPartialYear: a year whose strategy tail after SPX's Friday is a weekend is whole", () => {
    // Fri 2024-12-27, then Sat 28 / Sun 29 are the strategy's last 2024 days. The
    // strategy runs on into 2025 (Wed Jan 1 is an SPX day), so SPX is partial
    // overall, but its 2024 figure has every close 2024 could give it.
    const dates = [...days("2024-12-20", "2024-12-29"), ...days("2025-01-01", "2025-01-10")];
    expect(comparatorPartialYear("2024-12-27", dates, CALENDAR_WEEKDAY)).toBeNull();
    expect(comparatorPartialYear("2024-12-26", dates, CALENDAR_WEEKDAY)).toBe("2024");
  });
});
