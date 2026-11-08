/**
 * Phase 197 plan 01 (CLAR-01, D-05) - the discovery table's headers, Track column and volatility.
 *
 * THE DEFECT. An allocator reading the discovery table could not tell what period a figure covers
 * ("Return %" over what?), whether a rate is annualized, or how long a record is (a 40-day record
 * and a 4-year record sat in the same column shape). Volatility printed "+33.77%" although it can
 * never be negative, so the plus sign read as a gain.
 *
 * WHY THESE TESTS CAN FAIL. Each one pins a claim a reader acts on: a Track cell that read 12 on a
 * record whose figures carry the under-one-year marker would contradict the cell beside it; a
 * blank Track cell would read as zero. The boundary fixtures sit on 29/30 and 364/365 covered days,
 * the exact days the formula changes, so a changed divisor or floor fails by name.
 *
 * ANTI-VACUITY. The unsigned-volatility case is RED on the signed output that shipped before this
 * plan. The Track cases are RED before `trackMonths` and the Track column exist. The unknown-span
 * row is the ONLY row without dates, so "unknown sorts last" cannot pass by every row being unknown.
 *
 * Fixtures: every `series_end` is within 7 days of the frozen clock (the span varies through
 * `series_start`), so the stale partition plan 03 adds never reorders them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

type Row = Strategy & { analytics: StrategyAnalytics; analyticsPresent?: boolean };

const FROZEN_NOW = "2026-11-08T12:00:00Z";
const SERIES_END = "2026-11-07";
const EM_DASH = "—";

/** The ISO day that makes a record ending on `end` cover exactly `covered` days (both ends counted). */
function startFor(end: string, covered: number): string {
  const ms = Date.parse(`${end}T00:00:00Z`) - (covered - 1) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function makeRow(
  id: string,
  name: string,
  analytics: Partial<StrategyAnalytics> & Record<string, unknown> = {},
): Row {
  return {
    id,
    name,
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    analytics: {
      id: `an-${id}`,
      strategy_id: id,
      computed_at: "2026-11-01T00:00:00Z",
      computing_started_at: null,
      computation_status: "complete",
      computation_error: null,
      benchmark: null,
      cumulative_return: 0.42,
      cagr: 0.18,
      volatility: 0.22,
      sharpe: 1.5,
      sortino: 1.9,
      calmar: 1.1,
      max_drawdown: -0.12,
      max_drawdown_duration_days: 30,
      six_month_return: 0.21,
      sparkline_returns: [0, 1, 2, 3, 4],
      sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
      metrics_json: null,
      returns_series: null,
      drawdown_series: null,
      monthly_returns: null,
      daily_returns: null,
      rolling_metrics: null,
      return_quantiles: null,
      trade_metrics: null,
      volume_metrics: null,
      exposure_metrics: null,
      data_quality_flags: null,
      trades_fetched_at: null,
      ...analytics,
    } as unknown as StrategyAnalytics,
    analyticsPresent: true,
  };
}

/** A row whose record covers exactly `covered` days, ending on the shared series end. */
function rowWithSpan(id: string, name: string, covered: number, extra: Record<string, unknown> = {}): Row {
  return makeRow(id, name, {
    series_start: startFor(SERIES_END, covered),
    series_end: SERIES_END,
    ...extra,
  });
}

function renderTable(rows: Row[]) {
  return render(<StrategyTable strategies={rows} categorySlug="headers-spec" />);
}

/** The sort button of the header whose accessible name is exactly `name`. */
function headerButton(name: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("thead th button"));
  const hit = buttons.find((b) => b.getAttribute("aria-label") === name);
  if (!hit) throw new Error(`no header button named "${name}"; have ${buttons.map((b) => b.getAttribute("aria-label")).join(" | ")}`);
  return hit;
}

/** The body cell of `row` that sits under the header named `name` (by column position, not a guessed index). */
function cellUnder(name: string, row: HTMLElement): HTMLTableCellElement {
  const ths = Array.from(document.querySelectorAll<HTMLTableCellElement>("thead th"));
  const idx = ths.findIndex((th) => th.querySelector("button")?.getAttribute("aria-label") === name);
  if (idx < 0) throw new Error(`no header "${name}"`);
  return row.querySelectorAll<HTMLTableCellElement>(":scope > td")[idx];
}

function rowFor(name: string): HTMLElement {
  const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => (tr.textContent ?? "").includes(name));
  if (!row) throw new Error(`no rendered row for "${name}"`);
  return row as HTMLElement;
}

function renderedOrder(names: string[]): string[] {
  return Array.from(document.querySelectorAll("tbody tr"))
    .map((tr) => names.find((n) => (tr.textContent ?? "").includes(n)) ?? "")
    .filter(Boolean);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FROZEN_NOW));
  installFetchMock();
  try {
    window.localStorage.clear();
  } catch {
    // non-fatal in jsdom
  }
});

afterEach(() => {
  restoreFetchMock();
  vi.useRealTimers();
});

const TRACK = "Track, months of record";

describe("CLAR-01 Track column (D-05): months of record from the covered-day span", () => {
  it("shows 1 at 30 covered days and <1 at 29: a month is the smallest unit Track names", () => {
    renderTable([rowWithSpan("t-30", "Thirty Days", 30), rowWithSpan("t-29", "Twentynine Days", 29)]);
    expect(cellUnder(TRACK, rowFor("Thirty Days")).textContent?.trim()).toBe("1");
    expect(cellUnder(TRACK, rowFor("Twentynine Days")).textContent?.trim()).toBe("<1");
  });

  it("shows 12 at 365 covered days and 11 at 364, so Track agrees with the <1y marker beside the figures", () => {
    renderTable([rowWithSpan("t-365", "Full Year", 365), rowWithSpan("t-364", "Short Year", 364)]);
    const full = rowFor("Full Year");
    const short = rowFor("Short Year");
    expect(cellUnder(TRACK, full).textContent?.trim()).toBe("12");
    expect(cellUnder(TRACK, short).textContent?.trim()).toBe("11");
    // The 194 marker is on the 364-day row's CAGR and absent from the 365-day row's: Track and the
    // marker use one year.
    expect(short.textContent).toContain("<1y");
    expect(full.textContent).not.toContain("<1y");
  });

  it("shows an em dash, never a blank, when the record has no readable dates", () => {
    renderTable([makeRow("t-null", "No Dates"), rowWithSpan("t-30", "Thirty Days", 30)]);
    const cell = cellUnder(TRACK, rowFor("No Dates"));
    expect(cell.textContent?.trim()).toBe(EM_DASH);
    expect(cell.getAttribute("title")).toBeNull();
    expect(cell.className).toContain("text-text-muted");
  });

  it("titles a known span with the day count and the first and last day", () => {
    renderTable([rowWithSpan("t-30", "Thirty Days", 30)]);
    const cell = cellUnder(TRACK, rowFor("Thirty Days"));
    expect(cell.getAttribute("title")).toBe(`30 days of record, ${startFor(SERIES_END, 30)} to ${SERIES_END}.`);
  });

  it("counts a chain-broken row from headline_since, the record its figures are computed on", () => {
    // series_start is 400 days back, but the headline covers only the last 45: Track must say 1
    // month (45 days), not 13, and the title's first day is the headline start.
    const row = makeRow("t-broken", "Broken Chain", {
      series_start: startFor(SERIES_END, 400),
      series_end: SERIES_END,
      headline_since: startFor(SERIES_END, 45),
    });
    renderTable([row]);
    const cell = cellUnder(TRACK, rowFor("Broken Chain"));
    expect(cell.textContent?.trim()).toBe("1");
    expect(cell.getAttribute("title")).toBe(`45 days of record, ${startFor(SERIES_END, 45)} to ${SERIES_END}.`);
  });

  it("treats a present but malformed headline_since as an unknown length, not the full-series span (197 WR-01)", () => {
    // The 194 gate withholds this row's annualised figures because its dates cannot be read.
    // Track must not print the generous full-series span (18 months here) beside them.
    const row = makeRow("t-bad", "Bad Headline", {
      series_start: startFor(SERIES_END, 550),
      series_end: SERIES_END,
      headline_since: "not-a-date",
    });
    renderTable([row]);
    const cell = cellUnder(TRACK, rowFor("Bad Headline"));
    expect(cell.textContent?.trim()).toBe(EM_DASH);
    expect(cell.getAttribute("title")).toBeNull();
  });

  describe("sorting", () => {
    it("sorts an unreadable-record row last ascending and descending, never by its full-series span (197 WR-01)", () => {
      const bad = makeRow("bad", "Bad Headline", {
        series_start: startFor(SERIES_END, 900),
        series_end: SERIES_END,
        headline_since: "not-a-date",
      });
      renderTable([bad, rowWithSpan("s", "Short Record", 100), rowWithSpan("m", "Mid Record", 200)]);
      const names = ["Short Record", "Mid Record", "Bad Headline"];
      fireEvent.click(headerButton(TRACK));
      expect(renderedOrder(names)).toEqual(["Mid Record", "Short Record", "Bad Headline"]);
      fireEvent.click(headerButton(TRACK));
      expect(renderedOrder(names)).toEqual(["Short Record", "Mid Record", "Bad Headline"]);
    });

    const names = ["Long Record", "Mid Record", "Mid Twin", "Unknown Record"];
    const rows = () => [
      makeRow("u", "Unknown Record"),
      rowWithSpan("m1", "Mid Record", 200),
      rowWithSpan("m2", "Mid Twin", 200),
      rowWithSpan("l", "Long Record", 700),
    ];

    it("sorts desc on the first click, with unknown spans last", () => {
      renderTable(rows());
      fireEvent.click(headerButton(TRACK));
      expect(renderedOrder(names)).toEqual(["Long Record", "Mid Record", "Mid Twin", "Unknown Record"]);
    });

    it("keeps unknown spans last when the direction flips to asc", () => {
      renderTable(rows());
      fireEvent.click(headerButton(TRACK));
      fireEvent.click(headerButton(TRACK));
      // The null-coerced-to-0 artifact would march the unknown row to the top here.
      const order = renderedOrder(names);
      expect(order[order.length - 1]).toBe("Unknown Record");
      expect(order[0]).toBe("Mid Record");
    });

    it("keeps input order for equal spans in both directions (stable sort)", () => {
      renderTable(rows());
      fireEvent.click(headerButton(TRACK));
      const desc = renderedOrder(names);
      expect(desc.indexOf("Mid Record")).toBeLessThan(desc.indexOf("Mid Twin"));
      fireEvent.click(headerButton(TRACK));
      const asc = renderedOrder(names);
      expect(asc.indexOf("Mid Record")).toBeLessThan(asc.indexOf("Mid Twin"));
    });

    it("carries no percentile suffix on the Track column", () => {
      const { container } = render(
        <StrategyTable
          strategies={rows()}
          categorySlug="headers-spec-pct"
          percentiles={{ l: { cumulative_return: 90, cagr: 90, sharpe: 90, max_drawdown: 90, volatility: 90 } } as never}
        />,
      );
      fireEvent.click(within(container).getByRole("button", { name: TRACK }));
      expect(rowFor("Long Record").textContent).not.toMatch(/P\d\d/);
    });
  });
});

describe("CLAR-01 Track header (D-05)", () => {
  it("names its period and has the UI-SPEC accessible name and qualifier", () => {
    renderTable([rowWithSpan("t-30", "Thirty Days", 30)]);
    const button = headerButton(TRACK);
    expect(button.textContent).toContain("Track");
    expect(button.textContent?.toLowerCase()).toContain("months of record");
  });

  it("shows the definition tooltip on keyboard focus of the sort button", async () => {
    renderTable([rowWithSpan("t-30", "Thirty Days", 30)]);
    fireEvent.focus(headerButton(TRACK));
    const tip = await within(document.body).findByRole("tooltip");
    expect(tip.textContent).toBe("How long the record is, in whole months. Counted over the days its returns cover.");
  });
});

// ---------------------------------------------------------------------------
// Task 2 - every header states its period and annualisation (U-01, U-05, U-06).
// The expected strings are written out here, not imported from the map, so a
// changed header or accessible name fails this file instead of following the map.
// ---------------------------------------------------------------------------

const SORTABLE_HEADERS: Array<{
  name: string;
  label: string;
  qualifier: string;
  tooltip: string;
}> = [
  {
    name: "Return, full record, not annualized",
    label: "Return",
    qualifier: "full record · not ann.",
    tooltip:
      "Total return over the whole record. From the first return day, or from the last break in the record.",
  },
  {
    name: "CAGR, full record, annualized",
    label: "CAGR",
    qualifier: "full record · ann.",
    tooltip:
      "Compound annual growth rate over the whole record. From the first return day, or from the last break in the record.",
  },
  {
    name: "Sharpe, full record, annualized",
    label: "Sharpe",
    qualifier: "full record · ann.",
    tooltip:
      "Annualized return divided by annualized volatility over the whole record. From the first return day, or from the last break in the record.",
  },
  {
    name: "Max DD, full record, not annualized",
    label: "Max DD",
    qualifier: "full record · not ann.",
    tooltip:
      "The largest fall from a peak over the whole record. From the first return day, or from the last break in the record.",
  },
  {
    name: "Volatility, full record, annualized",
    label: "Volatility",
    qualifier: "full record · ann.",
    tooltip:
      "How much daily returns vary, annualized over the whole record. It is never negative, so it carries no sign.",
  },
  {
    name: "Return, last 6 months, not annualized",
    label: "Return",
    qualifier: "last 6 months · not ann.",
    tooltip: "Return over the 182 calendar days that end on the record's last day.",
  },
  {
    name: "AUM, stated by manager",
    label: "AUM",
    qualifier: "stated by manager",
    tooltip:
      "Assets under management as the manager states it. It is not measured from the exchange.",
  },
];

describe("CLAR-01 headers (D-05): label line, qualifier line, accessible name, definition", () => {
  it.each(SORTABLE_HEADERS)("$name: shows the label and qualifier lines", ({ name, label, qualifier }) => {
    renderTable([rowWithSpan("t-30", "Thirty Days", 30)]);
    const button = headerButton(name);
    // textContent joins the two lines: the label first, then the qualifier text.
    expect(button.textContent).toContain(label);
    expect(button.textContent).toContain(qualifier);
    // WCAG 2.5.3: the visible label text is part of the accessible name.
    expect(name).toContain(label);
  });

  it.each(SORTABLE_HEADERS)("$name: keyboard focus shows its definition tooltip", async ({ name, tooltip }) => {
    renderTable([rowWithSpan("t-30", "Thirty Days", 30)]);
    fireEvent.focus(headerButton(name));
    const tip = await within(document.body).findByRole("tooltip");
    expect(tip.textContent).toBe(tooltip);
  });

  it("the column header (th) carries the same accessible name as its sort button", () => {
    // WHY: name-from-content over the two visible lines concatenates without separators in some
    // engines ("Returnfull record"), and a reader hears the th name for every figure under it.
    renderTable([rowWithSpan("t-30", "Thirty Days", 30)]);
    for (const { name } of SORTABLE_HEADERS) {
      const th = headerButton(name).closest("th");
      expect(th?.getAttribute("aria-label")).toBe(name);
    }
  });

  it("each qualifier unit is whole (nowrap) and only the separator can wrap", () => {
    renderTable([rowWithSpan("t-30", "Thirty Days", 30)]);
    const button = headerButton("CAGR, full record, annualized");
    const units = Array.from(button.querySelectorAll("span.whitespace-nowrap")).map((n) => n.textContent);
    expect(units).toEqual(["full record", "ann."]);
    const separator = button.querySelector('span[aria-hidden="true"]:not(:has(*))');
    expect(separator?.textContent?.trim()).toBe("·");
  });

  it("has no header that says 1y: a full-record figure never claims a period it does not cover", () => {
    renderTable([rowWithSpan("t-30", "Thirty Days", 30)]);
    const heads = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent ?? "");
    for (const h of heads) expect(h).not.toMatch(/\b1y\b/i);
  });

  it("the sparkline headers read Return curve and Underwater, each full record; exactly two headers start with Return", () => {
    renderTable([rowWithSpan("t-30", "Thirty Days", 30)]);
    const ths = Array.from(document.querySelectorAll<HTMLTableCellElement>("thead th"));
    const curve = ths.find((th) => th.getAttribute("aria-label") === "Return curve, full record");
    const under = ths.find((th) => th.getAttribute("aria-label") === "Underwater, full record");
    expect(curve?.textContent).toContain("Return curve");
    expect(curve?.textContent?.toLowerCase()).toContain("full record");
    expect(under?.textContent).toContain("Underwater");
    expect(under?.textContent?.toLowerCase()).toContain("full record");
    // Return (full record) and Return (last 6 months) are the only sort buttons that start with it.
    const returnButtons = Array.from(document.querySelectorAll("thead th button")).filter((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Return"),
    );
    expect(returnButtons).toHaveLength(2);
    // The sparkline headers are plain: no sort button.
    expect(curve?.querySelector("button")).toBeNull();
    expect(ths[ths.length - 1].textContent).toBe("Actions");
  });
});

describe("CLAR-01 volatility (D-05): unsigned", () => {
  it("renders 33.77% and never +33.77% for a finite volatility", () => {
    // Long enough record that the figure is shown (not withheld or marked): 700 covered days.
    renderTable([rowWithSpan("v-1", "Vol Row", 700, { volatility: 0.3377 })]);
    const cell = cellUnder("Volatility, full record, annualized", rowFor("Vol Row"));
    expect(cell.textContent).toContain("33.77%");
    expect(cell.textContent).not.toContain("+");
    expect(cell.className).toContain("text-text-secondary");
  });

  it("a null volatility is still a muted em dash", () => {
    renderTable([rowWithSpan("v-2", "Null Vol", 700, { volatility: null })]);
    const cell = cellUnder("Volatility, full record, annualized", rowFor("Null Vol"));
    expect(cell.textContent?.trim()).toBe(EM_DASH);
    expect(cell.className).toContain("text-text-muted");
  });

  it("a withheld volatility (record under the gate) is still the withheld cell, not a figure", () => {
    // 10 covered days on a crypto record: the 194 gate withholds annualized figures.
    renderTable([rowWithSpan("v-3", "Withheld Vol", 10, { volatility: 0.3377 })]);
    const cell = cellUnder("Volatility, full record, annualized", rowFor("Withheld Vol"));
    expect(cell.textContent).not.toContain("33.77%");
    expect(cell.textContent).toContain(EM_DASH);
    expect(cell.querySelector("span[title]")?.getAttribute("title")).toMatch(/^Withheld until the record reaches/);
  });
});
