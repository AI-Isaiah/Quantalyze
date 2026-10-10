/** @vitest-environment jsdom */
/**
 * Phase 169 D-57 (SC6 as widened 2026-09-27): a 6 Month or 1 Year row, like
 * 3 Year and 5 Year, is NOT SHOWN for a record shorter than the period, in BOTH
 * return panels (Cumulative Return Metrics and the Main Metrics "Returns"
 * panel), on the factsheet AND on the scenario composer's mount.
 *
 * Why this matters: measured on PROD `/allocations?tab=scenario`, a blend shorter
 * than six months showed 6 Month = Year-to-date = 1 Year = its since-inception
 * figure: three labels claiming three periods the record never covered. compute()
 * now reports those windows as null (169-04, D-11); this pins that the rail omits
 * the row rather than printing a figure or an em-dash under the period's label,
 * and that the two panels agree, so the page never shows a row one panel hides.
 *
 * What still renders an em-dash, deliberately: the month row (Month-to-date, or
 * Final month on an ended record, Phase 170 AD-10), 3 Month and
 * Year-to-date (YTD is a calendar window, D-11), and a BENCH value that is null
 * on a row whose strategy window exists (a comparator gap never removes a row).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload, type BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";

import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { MetricsColumn } from "./MetricsColumn";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      lsStore.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      lsStore.delete(k);
    }),
    clear: vi.fn(() => lsStore.clear()),
    key: vi.fn(() => null),
    length: 0,
  });
});

const DAY = 86_400_000;

/** `n` consecutive calendar-day returns from the given UTC start date. */
function dailies(startIso: string, n: number): { date: string; value: number }[] {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * DAY).toISOString().slice(0, 10),
    value: Math.sin(i / 7) * 0.01 + 0.0005,
  }));
}

/** About 100 calendar days, starting after 1 January (so YTD is not covered either). */
const SHORT = () => dailies("2024-03-01", 100);
/** About 400 calendar days: covers 6 Month and 1 Year. */
const LONG = () => dailies("2023-03-01", 400);

function factsheetPayload(points: { date: string; value: number }[], opts?: BuildFactsheetOpts): FactsheetPayload {
  const built = buildFactsheetPayload(
    {
      id: "window-rows-test",
      name: "Window Rows Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-29T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    points,
    opts,
  );
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  return built;
}

function renderColumn(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

function renderScenario(points: { date: string; value: number }[]) {
  const payload = buildScenarioFactsheetPayload({ portfolioDaily: points, periodsPerYear: 365 });
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideHeader hideAllocatorSection hideFooter={false} />
    </FactsheetProvider>,
  );
}

/** A panel by its h3 title. Throws (fails loud) if the mount does not render it. */
function section(container: HTMLElement, title: string): HTMLElement {
  const h = [...container.querySelectorAll("h3")].find((el) => el.textContent === title);
  if (!h) throw new Error(`no panel titled "${title}"`);
  return h.closest("section") as HTMLElement;
}

function rowLabels(panel: HTMLElement): string[] {
  return [...panel.querySelectorAll("tr")].map((r) => r.querySelector("td")?.textContent ?? "");
}

function cells(panel: HTMLElement, label: string): { value: string; bench: string } {
  const tr = [...panel.querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
  if (!tr) throw new Error(`no row "${label}"`);
  const tds = tr.querySelectorAll("td");
  return { value: tds[1]?.textContent ?? "", bench: tds[2]?.textContent ?? "" };
}

/** MetricsColumn's own percentage rendering (signed, two decimals, em-dash on non-finite). */
function pctSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const x = v * 100;
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

const CUMULATIVE = "Cumulative Return Metrics";
const RETURNS = "Returns";

describe("factsheet mount: 6 Month / 1 Year rows exist only when the record covers them (D-57)", () => {
  it("a 100-day record: Cumulative Return Metrics has no 6 Month and no 1 Year row", () => {
    const payload = factsheetPayload(SHORT());
    expect(payload.strategyMetrics.p6m).toBeNull();
    expect(payload.strategyMetrics.p1y).toBeNull();
    const labels = rowLabels(section(renderColumn(payload).container, CUMULATIVE));
    expect(labels).not.toContain("6 Month");
    expect(labels).not.toContain("1 Year");
    // The kept rows are present, in their order.
    // Phase 170 AD-10: SHORT ends 2024-06-08, an ended record, so its month row names that month.
    const kept = ["Final month (Jun 2024)", "3 Month", "Year-to-date", "Since Inception", "CAGR"];
    expect(labels.filter((l) => kept.includes(l))).toEqual(kept);
  });

  it("a 100-day record: the Returns panel has no 6 Month and no 1 Year row", () => {
    const labels = rowLabels(section(renderColumn(factsheetPayload(SHORT())).container, RETURNS));
    expect(labels).not.toContain("6 Month");
    expect(labels).not.toContain("1 Year");
    // Phase 170 AD-10: SHORT ends 2024-06-08, an ended record, so its month row names that month.
    const kept = ["Final month (Jun 2024)", "Year-to-date", "3 Month", "Win Rate (days)", "Profit Factor"];
    expect(labels.filter((l) => kept.includes(l))).toEqual(kept);
  });

  it("a 100-day record starting after 1 January: Year-to-date is an em-dash row, not absent (a calendar window, D-11)", () => {
    const { container } = renderColumn(factsheetPayload(SHORT()));
    expect(cells(section(container, CUMULATIVE), "Year-to-date").value).toBe("—");
    expect(cells(section(container, RETURNS), "Year-to-date").value).toBe("—");
    expect(cells(section(container, CUMULATIVE), "3 Month").value).not.toBe("—");
  });

  it("a 400-day record: both panels show 6 Month and 1 Year with compute()'s p6m / p1y", () => {
    const payload = factsheetPayload(LONG());
    const m = payload.strategyMetrics;
    expect(m.p6m).toEqual(expect.any(Number));
    expect(m.p1y).toEqual(expect.any(Number));
    const { container } = renderColumn(payload);
    for (const title of [CUMULATIVE, RETURNS]) {
      const panel = section(container, title);
      expect(cells(panel, "6 Month").value, title).toBe(pctSigned(m.p6m));
      expect(cells(panel, "1 Year").value, title).toBe(pctSigned(m.p1y));
    }
  });

  it("the gate reads the STRATEGY window: a numeric comparator p6m / p1y does not bring the rows back", () => {
    const payload = factsheetPayload(SHORT());
    const key = "btc" as const;
    const summary = payload.comparators[key].summary;
    if (!summary) throw new Error("the fixture's btc comparator has no summary");
    const withBench: FactsheetPayload = {
      ...payload,
      activeComparator: key,
      comparators: { ...payload.comparators, [key]: { ...payload.comparators[key], summary: { ...summary, p6m: 0.1234, p1y: 0.2345 } } },
    };
    const { container } = renderColumn(withBench);
    const labels = rowLabels(section(container, RETURNS));
    expect(labels).not.toContain("6 Month");
    expect(labels).not.toContain("1 Year");
    expect(container.textContent).not.toContain("+12.34%");
  });

  it("a null BENCH window never removes a row: a 400-day record whose comparator p6m is null keeps the row, bench cell em-dash", () => {
    const payload = factsheetPayload(LONG());
    const key = "btc" as const;
    const summary = payload.comparators[key].summary;
    if (!summary) throw new Error("the fixture's btc comparator has no summary");
    const withGap: FactsheetPayload = {
      ...payload,
      activeComparator: key,
      comparators: { ...payload.comparators, [key]: { ...payload.comparators[key], summary: { ...summary, p6m: null } } },
    };
    const row = cells(section(renderColumn(withGap).container, RETURNS), "6 Month");
    expect(row.value).toBe(pctSigned(payload.strategyMetrics.p6m));
    expect(row.bench).toBe("—");
  });
});

/**
 * Phase 164.6.6.3.3 plan 08 (UI-SPEC 1.6, B20, D-12): the 6 Month and 1 Year rows
 * follow the RECORD's length, not the value. A long chain-broken record whose
 * Dated suffix is too short for the window has a null p6m / p1y, and the row
 * reads "—" instead of disappearing. 3 Year and 5 Year keep Phase 169 D-17's null
 * rule (UI-SPEC 7 item 6, a founder decision this phase does not amend).
 */
describe("a long Dated record whose suffix is short (D-12, B20)", () => {
  const points = LONG();
  const datedPayload = factsheetPayload(points, {
    dataQuality: {
      composite: false,
      insufficientWindow: false,
      twrChainBroken: true,
      headlineCoversFrom: points[points.length - 12].date,
    },
    metricsByBasis: {
      cash_settlement: {
        cumulative_return: 0,
        volatility: 0,
        max_drawdown: 0,
        cagr: 0,
        sharpe: null,
        sortino: null,
        calmar: null,
      },
    },
  });

  it("fixture guard: the suffix leaves p3m, p6m and p1y null while the record is 400 days long", () => {
    const m = datedPayload.strategyMetrics;
    expect(m.p3m).toBeNull();
    expect(m.p6m).toBeNull();
    expect(m.p1y).toBeNull();
    expect(points.length).toBe(400);
  });

  it.each([CUMULATIVE, RETURNS])("%s: 6 Month and 1 Year rows are present and read an em-dash", (title) => {
    const panel = section(renderColumn(datedPayload).container, title);
    expect(rowLabels(panel), title).toContain("6 Month");
    expect(rowLabels(panel), title).toContain("1 Year");
    expect(cells(panel, "6 Month").value, title).toBe("—");
    expect(cells(panel, "1 Year").value, title).toBe("—");
  });

  it("Cumulative Return Metrics: 3 Year and 5 Year stay omitted (D-17's null rule)", () => {
    const labels = rowLabels(section(renderColumn(datedPayload).container, CUMULATIVE));
    expect(labels).not.toContain("3 Year");
    expect(labels).not.toContain("5 Year");
  });

  it("a SHORT Dated record still omits 6 Month and 1 Year: the record is shorter than the window", () => {
    const short = SHORT();
    const payload = factsheetPayload(short, {
      dataQuality: {
        composite: false,
        insufficientWindow: false,
        twrChainBroken: true,
        headlineCoversFrom: short[short.length - 12].date,
      },
    });
    const { container } = renderColumn(payload);
    for (const title of [CUMULATIVE, RETURNS]) {
      expect(rowLabels(section(container, title)), title).not.toContain("6 Month");
      expect(rowLabels(section(container, title)), title).not.toContain("1 Year");
    }
  });
});

/**
 * The scenario composer (`/allocations?tab=scenario`) mounts the real
 * FactsheetBody with the payload `buildScenarioFactsheetPayload` builds; that
 * builder calls compute(), so the same null windows reach the same rail.
 */
describe("scenario mount (FactsheetBody scenarioMode): the same rows are omitted (D-57)", () => {
  it("a 100-day blend: Cumulative Return Metrics has no 6 Month, 1 Year, 3 Year or 5 Year row; Since Inception is present", () => {
    const panel = section(renderScenario(SHORT()).container, CUMULATIVE);
    const labels = rowLabels(panel);
    for (const gone of ["6 Month", "1 Year", "3 Year", "5 Year"]) expect(labels).not.toContain(gone);
    expect(labels).toContain("Since Inception");
    expect(cells(panel, "Since Inception").value).not.toBe("—");
  });

  it("a 100-day blend: the Returns panel has no 6 Month and no 1 Year row", () => {
    const labels = rowLabels(section(renderScenario(SHORT()).container, RETURNS));
    expect(labels).not.toContain("6 Month");
    expect(labels).not.toContain("1 Year");
    expect(labels).toContain("3 Month");
  });

  /**
   * Phase 169 review round 1 (IN-03 / SFH L-1): an EMPTY blend (no dated
   * points) takes `emptyComputeSummary`, not compute(). It used to set p6m /
   * p1y to NaN, which passes the `!= null` gate and rendered "6 Month —" and
   * "1 Year —", while p3y / p5y were absent and their rows hidden: two rules in
   * one panel for one reason. A zero-observation blend is shorter than every
   * period, so D-57 omits all four.
   */
  it("an empty blend: neither panel has a 6 Month, 1 Year, 3 Year or 5 Year row", () => {
    const { container } = renderScenario([]);
    const cumulative = rowLabels(section(container, CUMULATIVE));
    for (const gone of ["6 Month", "1 Year", "3 Year", "5 Year"]) expect(cumulative, CUMULATIVE).not.toContain(gone);
    expect(cumulative, CUMULATIVE).toContain("Since Inception");
    const returns = rowLabels(section(container, RETURNS));
    for (const gone of ["6 Month", "1 Year"]) expect(returns, RETURNS).not.toContain(gone);
    expect(returns, RETURNS).toContain("3 Month");
  });

  it("a 400-day blend: both panels show 6 Month and 1 Year", () => {
    const { container } = renderScenario(LONG());
    for (const title of [CUMULATIVE, RETURNS]) {
      const labels = rowLabels(section(container, title));
      expect(labels, title).toContain("6 Month");
      expect(labels, title).toContain("1 Year");
    }
  });
});
