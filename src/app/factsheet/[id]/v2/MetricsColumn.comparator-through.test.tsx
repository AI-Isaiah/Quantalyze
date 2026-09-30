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
  it("comparatorPartialThrough: dated only when through is a string strictly before the last date", () => {
    expect(comparatorPartialThrough("2025-01-20", "2025-01-31")).toBe("2025-01-20");
    expect(comparatorPartialThrough("2025-01-31", "2025-01-31")).toBeNull();
    expect(comparatorPartialThrough(null, "2025-01-31")).toBeNull(); // unavailable: figures already "—"
    expect(comparatorPartialThrough(undefined, "2025-01-31")).toBeNull(); // hand-built block, D-21
  });

  it("comparatorPartialYear: null when through closes its year (the next year already reads '—')", () => {
    expect(comparatorPartialYear("2025-01-20", DATES)).toBe("2025");
    expect(comparatorPartialYear("2024-12-31", DATES)).toBeNull();
  });
});
