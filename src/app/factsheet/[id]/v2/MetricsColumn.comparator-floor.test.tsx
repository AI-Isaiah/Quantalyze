/** @vitest-environment jsdom */
/**
 * Phase 170.6 plan 11 (D-07), superseded by Phase 194 D-16 (founder 2026-11-07, review WR-01,
 * "D-15 wins"): the comparator's annualized set (Sharpe, Sortino, Calmar, CAGR, Ann. Volatility)
 * is no longer withheld for a short OVERLAP or a short zoomed window. It is withheld only with the
 * strategy's TOTAL record (D-15), and it always prints its cumulative return and max drawdown.
 *
 * Every expected string is typed by hand. The SPX closes below make five daily moves of
 * +1.0%, -0.5%, +1.2%, +0.3%, +0.8%; their compound is 1.01 * 0.995 * 1.012 * 1.003 * 1.008
 * = 1.0282209 (+2.82%), and the one dip is 1.01 -> 1.00495 (-0.50%).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

// The ONE seam for the SPX shape (build-payload.benchmark-opt.test.ts uses it too): SPX comes
// from the bundled fixture, not from `benchmarkPrices`, so a hand-typed series replaces it here.
// The SPX closes make five daily moves of +1.0%, -0.5%, +1.2%, +0.3%, +0.8%.
vi.mock("@/lib/factsheet/benchmarks", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/factsheet/benchmarks")>()),
  SPX_DAILY: [
    { date: "2024-07-26", close: 100 },
    { date: "2024-07-29", close: 101 },
    { date: "2024-07-30", close: 100.495 },
    { date: "2024-07-31", close: 101.70094 },
    { date: "2024-08-01", close: 102.006043 },
    { date: "2024-08-02", close: 102.822091 },
  ],
}));

import { FactsheetProvider } from "./factsheet-context";
import { windowView } from "./basis-context";
import { MetricsColumn } from "./MetricsColumn";
import { FactsheetBody } from "./FactsheetView";

const STRATEGY = {
  id: "s-170-6-11",
  name: "Comparator Floor Fixture",
  types: ["quant"],
  markets: ["equities"],
  computedAt: "2026-10-14T00:00:00Z",
  trustTier: null,
  assetClass: "equities",
  ingestSource: "csv" as const,
};

/** Mon 2024-07-29 .. Fri 2024-08-02, the strategy's five return days. */
const DATES = ["2024-07-29", "2024-07-30", "2024-07-31", "2024-08-01", "2024-08-02"];
const STRAT = [0.004, -0.002, 0.006, 0.001, -0.003];

function payload(): FactsheetPayload {
  const p = buildFactsheetPayload(
    STRATEGY,
    DATES.map((date, i) => ({ date, value: STRAT[i] })),
  );
  if (!p) throw new Error("fixture must build");
  return { ...p, activeComparator: "spx" };
}

function panel(container: HTMLElement, title: string): HTMLElement {
  const h = [...container.querySelectorAll("h3")].find(el => el.textContent === title);
  if (!h) throw new Error(`no panel titled "${title}"`);
  return h.closest("section") as HTMLElement;
}

/** The benchmark cell (third `td`) of the row whose first cell starts with `label`. Fails loud. */
function bench(container: HTMLElement, title: string, label: string): string {
  const tr = [...panel(container, title).querySelectorAll("tr")].find(r =>
    r.querySelector("td")?.textContent?.startsWith(label),
  );
  if (!tr) throw new Error(`no row "${label}" in "${title}"`);
  return tr.querySelectorAll("td")[2]?.textContent ?? "";
}

function rail(): HTMLElement {
  return render(
    <FactsheetProvider payload={payload()} persist={false}>
      <MetricsColumn />
    </FactsheetProvider>,
  ).container;
}

describe("D-19 on the rendered rail: a 5-day record withholds the benchmark column with the strategy's", () => {
  it("precondition: SPX is the selected comparator and its prices reach the strategy's last day", () => {
    expect(payload().comparators.spx.through).toBe("2024-08-02");
  });

  // The 5-day TOTAL record is under D-15's minimum, so the strategy column AND the benchmark
  // column read "—" for the five annualized cells (founder D-19, 2026-11-07).
  it.each(["Sharpe", "Sortino", "Calmar", "CAGR", "Ann. Volatility"])(
    "Main Metrics: the strategy and the SPX %s cells both read —",
    label => {
      const container = rail();
      const tr = [...panel(container, "Main Metrics").querySelectorAll("tr")].find(r =>
        r.querySelector("td")?.textContent?.startsWith(label),
      )!;
      expect(tr.querySelectorAll("td")[1]?.textContent).toBe("—");
      expect(bench(container, "Main Metrics", label)).toBe("—");
    },
  );

  it("Main Metrics: the SPX Cumulative Return stays", () => {
    expect(bench(rail(), "Main Metrics", "Cumulative Return")).toBe("+2.82%");
  });

  it("Max Drawdown: the SPX Max Drawdown stays", () => {
    expect(bench(rail(), "Max Drawdown", "Max Drawdown")).toBe("-0.50%");
  });
});

/**
 * Phase 170.6 plan 11 (D-08): the paired-floor sentence says when the comparator's prices end,
 * on both surfaces that print it (the KPI strip's floor line and the rail's section IV), and only
 * when they end before the strategy's last date.
 *
 * The strategy below runs Mon 2024-07-29 .. Wed 2024-08-07 (10 days). The mocked SPX closes end on
 * Fri 2024-08-02, so it pairs exactly 5 intervals (07-29 .. 08-02): below the floor of 10, and its
 * prices end 3 weekdays before the strategy does.
 */
const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, v),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
    key: () => null,
    length: 0,
  });
});

function longPayload(): FactsheetPayload {
  const dates = ["2024-07-29", "2024-07-30", "2024-07-31", "2024-08-01", "2024-08-02", "2024-08-03", "2024-08-04", "2024-08-05", "2024-08-06", "2024-08-07"];
  const p = buildFactsheetPayload(
    STRATEGY,
    dates.map((date, i) => ({ date, value: ((i % 5) - 2) / 500 })),
  );
  if (!p) throw new Error("fixture must build");
  return { ...p, activeComparator: "spx" };
}

function mountBody(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideHeader hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
}

describe("D-08: the paired-floor sentence dates a comparator that ends early", () => {
  it("precondition: SPX pairs 5 intervals, below the floor, and its prices end Aug 2", () => {
    const spx = longPayload().comparators.spx;
    expect(spx.jointWithheld).toEqual({ paired: 5, floor: 10 });
    expect(spx.through).toBe("2024-08-02");
  });

  it("the KPI strip line and section IV both end with 'SPX prices end Aug 2.'", () => {
    mountBody(longPayload());
    const reasons = screen.getAllByTestId("joint-floor-reason");
    expect(reasons).toHaveLength(2);
    for (const r of reasons) {
      expect(r.textContent).toBe(
        "Alpha and beta need at least 10 days paired with SPX; this record has 5. SPX prices end Aug 2.",
      );
    }
  });

  it("the comparator covering the strategy's last date: neither sentence carries the clause", () => {
    // The 5-day strategy of the cases above, whose SPX prices reach its last day (Fri Aug 2).
    mountBody(payload());
    const reasons = screen.getAllByTestId("joint-floor-reason");
    expect(reasons).toHaveLength(2);
    for (const r of reasons) {
      expect(r.textContent).toBe("Alpha and beta need at least 10 days paired with SPX; this record has 5.");
    }
  });
});

/**
 * Phase 194 D-16 (review WR-01): the "need 90 days of overlap" line of 170.6 SFH-1 is gone, since
 * a short overlap no longer withholds. The one muted `figure-gate-note` speaks for both columns.
 */
describe("D-16: the comparator columns carry no overlap-length reason", () => {
  const REASON_ID = "comparator-annualization-reason";

  it("a 5-day record prints no overlap reason line (the strategy's own note speaks)", () => {
    rail();
    expect(screen.queryByTestId(REASON_ID)).toBeNull();
  });

  /** A 7-day strategy and a 7-day BTC series over the same `from`..`to`, BTC selected. */
  function btcPayload(from: string, to: string): FactsheetPayload {
    const DAY = 86_400_000;
    const dates: string[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
      dates.push(new Date(t).toISOString().slice(0, 10));
    }
    const prevDay = new Date(Date.parse(`${from}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
    const prices = [prevDay, ...dates].map((date, i) => ({ date, close: 100 + i + ((i % 3) - 1) }));
    const p = buildFactsheetPayload(
      STRATEGY,
      dates.map((date, i) => ({ date, value: ((i % 5) - 2) / 500 })),
      { recordObservations: dates.length, benchmarkPrices: { prices, through: prices[prices.length - 1].date, dropped: [] } },
    );
    if (!p) throw new Error("fixture must build");
    return { ...p, activeComparator: "btc" };
  }

  function railFor(p: FactsheetPayload): HTMLElement {
    return render(
      <FactsheetProvider payload={p} persist={false}>
        <MetricsColumn />
      </FactsheetProvider>,
    ).container;
  }

  it("89 elapsed days (2024-01-01 .. 2024-03-30, 90 returns, over D-15's 60): the Sharpe prints and there is no reason line", () => {
    const container = railFor(btcPayload("2024-01-01", "2024-03-30"));
    expect(screen.queryByTestId(REASON_ID)).toBeNull();
    expect(bench(container, "Main Metrics", "Sharpe")).not.toBe("—");
  });

  it("90 elapsed days (2024-01-01 .. 2024-03-31): the figures print and there is no reason line", () => {
    const container = railFor(btcPayload("2024-01-01", "2024-03-31"));
    expect(screen.queryByTestId(REASON_ID)).toBeNull();
    expect(bench(container, "Main Metrics", "Sharpe")).not.toBe("—");
  });

  it("no comparator selected: no reason line", () => {
    render(
      <FactsheetProvider payload={{ ...payload(), activeComparator: "none" }} persist={false}>
        <MetricsColumn />
      </FactsheetProvider>,
    );
    expect(screen.queryByTestId(REASON_ID)).toBeNull();
  });
});

/**
 * D-16 on a zoom: a record that clears D-15 and is zoomed to 30 days keeps the benchmark's five
 * annualized figures (the strategy's strip shows them with the muted note), where 170.6 D-07
 * turned them to NaN under 90 days of slice.
 */
describe("D-16: a zoom under 90 days keeps the benchmark's annualized figures", () => {
  const DAY = 86_400_000;
  const dates = Array.from({ length: 200 }, (_, i) => new Date(Date.parse("2024-01-01T00:00:00Z") + i * DAY).toISOString().slice(0, 10));

  it("windowView of the last 30 days has a finite BTC Sharpe, Sortino, Calmar, CAGR and volatility", () => {
    const prices = ["2023-12-31", ...dates].map((date, i) => ({
      date,
      close: 100 + i + ((i % 3) - 1) * 2,
    }));
    const p = buildFactsheetPayload(
      STRATEGY,
      dates.map((date, i) => ({ date, value: ((i % 5) - 2) / 500 })),
      { recordObservations: dates.length, benchmarkPrices: { prices, through: prices[prices.length - 1].date, dropped: [] } },
    );
    if (!p) throw new Error("fixture must build");
    const w = windowView({ ...p, activeComparator: "btc" }, 170, 199);
    const summary = w.comparators.btc.summary;
    expect(summary).toBeTruthy();
    for (const k of ["sharpe", "sortino", "calmar", "cagr", "ann_vol"] as const) {
      expect(Number.isFinite(summary![k]), k).toBe(true);
    }
  });
});
