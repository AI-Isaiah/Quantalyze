/** @vitest-environment jsdom */
/**
 * Phase 164.6.6.3.3 FACTSHEETTRUTH plan 10 (B19, UI-SPEC 1.5, T-164.6.6.3.3-21 and -22):
 * on a Dated row at full history every rail row compares two figures over ONE span.
 *
 * Before this plan the strategy's headline figures covered the suffix from `{D}`
 * while the benchmark column (`jointCmp.summary`) covered the whole record, so a row
 * set a 12-day strategy figure beside a whole-record comparator figure.
 *
 *   headline rows   (Cumulative Return, CAGR, Ann. Volatility, Sharpe, Sortino, Calmar,
 *                    the trailing returns, Max Drawdown): the comparator over the suffix.
 *   whole-record    (Win Rate, Profit Factor, Longest DD): the whole-record comparator.
 *   Withheld row    headline rows' benchmark cells read "—"; whole-record rows unchanged.
 *   clean row, a selected range: the benchmark cells are exactly what they were.
 *
 * The expected values are computed HERE, by an oracle that slices the comparator's
 * own daily returns and calls `compute()`; they are not read off `summarySince`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
import { buildFactsheetPayload, type BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import { compute } from "@/lib/factsheet/compute";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";

import { FactsheetProvider, useXRange } from "./factsheet-context";
import { windowView } from "./basis-context";
import { MetricsColumn } from "./MetricsColumn";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

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

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const N = 400;
const FIRST = "2024-01-01";
/** The first measured day: 12 days before the record's end. */
const SINCE = addDays(FIRST, N - 12);
const PPY = 365;

const STRATEGY = {
  id: "headline-bench-test",
  name: "Headline Bench Test",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-09T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

const rows: DailyReturn[] = Array.from({ length: N }, (_, i) => ({
  date: addDays(FIRST, i),
  value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
}));

/** BTC closes: violent before SINCE, quiet after, so the two spans cannot agree. */
const btc: DailyPrice[] = (() => {
  const out: DailyPrice[] = [];
  let close = 40000;
  for (let i = -1; i < N; i++) {
    const r = i < 0 ? 0 : i < N - 12 ? ((i % 9) - 4) / 40 : ((i % 4) - 1.5) / 400;
    close *= 1 + r;
    out.push({ date: addDays(FIRST, i), close });
  }
  return out;
})();
const prices: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };

type DQ = NonNullable<FactsheetPayload["dataQuality"]>;
const DATED: DQ = {
  composite: false,
  twrChainBroken: true,
  headlineCoversFrom: SINCE,
  headlineGuardReasons: ["negative_nav"],
};
const WITHHELD: DQ = {
  composite: false,
  twrChainBroken: true,
  headlineWithheld: true,
  headlineGuardReasons: ["negative_nav"],
};

function build(dataQuality?: DQ): FactsheetPayload {
  const p = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: prices, dataQuality });
  if (!p) throw new Error("fixture must build");
  return { ...p, activeComparator: "btc" };
}

function RangeHarness({ range }: { range: readonly [number, number] }) {
  const { setXRange } = useXRange();
  return (
    <button data-testid="zoom" onClick={() => setXRange(range)}>
      zoom
    </button>
  );
}

function mount(payload: FactsheetPayload, range?: readonly [number, number]) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      {range && <RangeHarness range={range} />}
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

async function selectRange() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("zoom"));
  });
}

function panel(container: HTMLElement, title: string): HTMLElement {
  const h = [...container.querySelectorAll("h3")].find((el) => el.textContent === title);
  if (!h) throw new Error(`no panel titled "${title}"`);
  return h.closest("section") as HTMLElement;
}

/** The benchmark cell (third `td`) of the row whose first cell is `label`. Fails loud. */
function bench(container: HTMLElement, title: string, label: string): string {
  const tr = [...panel(container, title).querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
  if (!tr) throw new Error(`no row "${label}" in "${title}"`);
  return tr.querySelectorAll("td")[2]?.textContent ?? "";
}

/** The benchmark cell of the first body row of a panel (the month row, whatever it is labelled). */
function firstBench(container: HTMLElement, title: string): string {
  const tr = panel(container, title).querySelector("tbody tr");
  if (!tr) throw new Error(`no rows in "${title}"`);
  return tr.querySelectorAll("td")[2]?.textContent ?? "";
}

// Hand-typed renderers (the rail's own are not exported, and an import would be no oracle).
const dash = "—";
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const pctS = (v: number | null | undefined) => (fin(v) ? `${v * 100 >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%` : dash);
const pctU = (v: number | null | undefined) => (fin(v) ? `${(v * 100).toFixed(2)}%` : dash);
const n2 = (v: number | null | undefined) => (fin(v) ? v.toFixed(2) : dash);
const cnt = (v: number | null | undefined) => (fin(v) ? String(v) : dash);

/** compute() over the comparator's covered daily returns dated on or after `from` (or all of them). */
function oracle(p: FactsheetPayload, from?: string) {
  const d = p.comparators.btc.dailyReturns!;
  const r: number[] = [];
  const dt: string[] = [];
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (v != null && (from === undefined || p.dates[i] >= from)) {
      r.push(v);
      dt.push(p.dates[i]);
    }
  }
  return compute(r, dt, 0, PPY);
}

const MAIN = "Main Metrics";
const RETURNS = "Returns";
const MAXDD = "Max Drawdown";

/** Every benchmark cell the rail prints for the headline rows, as rendered text. */
function headlineBenchCells(container: HTMLElement) {
  return {
    cum: bench(container, MAIN, "Cumulative Return"),
    cagr: bench(container, MAIN, "CAGR"),
    vol: bench(container, MAIN, "Ann. Volatility"),
    sharpe: bench(container, MAIN, "Sharpe"),
    sortino: bench(container, MAIN, "Sortino"),
    calmar: bench(container, MAIN, "Calmar"),
    month: firstBench(container, RETURNS),
    ytd: bench(container, RETURNS, "Year-to-date"),
    p3m: bench(container, RETURNS, "3 Month"),
    p6m: bench(container, RETURNS, "6 Month"),
    p1y: bench(container, RETURNS, "1 Year"),
    maxdd: bench(container, MAXDD, "Max Drawdown"),
  };
}

function expectedHeadline(s: ReturnType<typeof oracle>) {
  return {
    cum: pctS(s.cum_ret),
    cagr: pctS(s.cagr),
    vol: pctU(s.ann_vol),
    sharpe: n2(s.sharpe),
    sortino: n2(s.sortino),
    calmar: n2(s.calmar),
    month: pctS(s.mtd),
    ytd: pctS(s.ytd),
    p3m: pctS(s.p3m),
    p6m: pctS(s.p6m),
    p1y: pctS(s.p1y),
    maxdd: pctU(s.max_dd),
  };
}

describe("a Dated row: each headline benchmark cell is the comparator over the span from {D} (B19)", () => {
  it("precondition: the suffix and the whole-record comparator figures really differ", () => {
    const p = build(DATED);
    const whole = expectedHeadline(oracle(p));
    const since = expectedHeadline(oracle(p, SINCE));
    expect(since.cum).not.toBe(whole.cum);
    expect(since.vol).not.toBe(whole.vol);
    expect(since.maxdd).not.toBe(whole.maxdd);
    // The rail prints the 12-day suffix as the strategy's own span; the oracle agrees it is 12 days.
    expect(p.dates.filter((d) => d >= SINCE)).toHaveLength(12);
  });

  it("Main Metrics, Returns and Max Drawdown bench cells equal the independent suffix oracle", () => {
    const p = build(DATED);
    const { container } = mount(p);
    expect(headlineBenchCells(container)).toEqual(expectedHeadline(oracle(p, SINCE)));
  });

  it("the cells that need more than the suffix hold read the em-dash, not the whole-record value", () => {
    const p = build(DATED);
    const whole = expectedHeadline(oracle(p));
    // The whole-record comparator has a 3 Month, 6 Month and 1 Year; the 12-day suffix has none.
    expect(whole.p3m).not.toBe(dash);
    expect(whole.p1y).not.toBe(dash);
    const { container } = mount(p);
    const cells = headlineBenchCells(container);
    expect(cells.p3m).toBe(dash);
    expect(cells.p6m).toBe(dash);
    expect(cells.p1y).toBe(dash);
  });

  it("Win Rate, Profit Factor and Longest DD keep the WHOLE-record comparator on the same rows", () => {
    const p = build(DATED);
    const w = oracle(p);
    const s = oracle(p, SINCE);
    // The fixture is built so the two spans differ on these figures too: otherwise this pins nothing.
    expect(pctU(w.win_rate)).not.toBe(pctU(s.win_rate));
    expect(n2(w.profit_factor)).not.toBe(n2(s.profit_factor));
    expect(cnt(w.longest_dd)).not.toBe(cnt(s.longest_dd));
    const { container } = mount(p);
    expect(bench(container, RETURNS, "Win Rate (days)")).toBe(pctU(w.win_rate));
    expect(bench(container, RETURNS, "Profit Factor")).toBe(n2(w.profit_factor));
    expect(bench(container, MAXDD, "Longest DD (days)")).toBe(cnt(w.longest_dd));
  });
});

describe("a Withheld row: no measured span, so the headline benchmark cells read the em-dash (B19)", () => {
  it("every headline benchmark cell is the em-dash", () => {
    const { container } = mount(build(WITHHELD));
    for (const [k, v] of Object.entries(headlineBenchCells(container))) expect(v, k).toBe(dash);
  });

  it("the whole-record rows are unchanged: the whole-record comparator figures", () => {
    const p = build(WITHHELD);
    const w = oracle(p);
    const { container } = mount(p);
    expect(bench(container, RETURNS, "Win Rate (days)")).toBe(pctU(w.win_rate));
    expect(bench(container, RETURNS, "Profit Factor")).toBe(n2(w.profit_factor));
    expect(bench(container, MAXDD, "Longest DD (days)")).toBe(cnt(w.longest_dd));
  });
});

/** The strategy's own value cell (second `td`) of the row whose first cell is `label`. Fails loud. */
function strat(container: HTMLElement, title: string, label: string): string {
  const tr = [...panel(container, title).querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
  if (!tr) throw new Error(`no row "${label}" in "${title}"`);
  return tr.querySelectorAll("td")[1]?.textContent ?? "";
}

/** The strategy value cell of the first body row of a panel (the month row, whatever it is labelled). */
function firstStrat(container: HTMLElement, title: string): string {
  const tr = panel(container, title).querySelector("tbody tr");
  if (!tr) throw new Error(`no rows in "${title}"`);
  return tr.querySelectorAll("td")[1]?.textContent ?? "";
}

/**
 * WR-01 (review round 1): the strategy and benchmark columns follow ONE rule on a
 * Withheld row. The benchmark cells read the em-dash (above); the strategy's own
 * trailing windows must too, in the Returns panel and in Cumulative Return Metrics,
 * or the rail prints a whole-record number that compounds across the break beside a
 * blank comparator, under a note that says the figures are withheld.
 */
describe("a Withheld row: the strategy's trailing windows read the em-dash beside the benchmark's (WR-01)", () => {
  const RETURNS_ROWS = ["Year-to-date", "3 Month", "6 Month", "1 Year"];
  const CUMULATIVE = "Cumulative Return Metrics";

  it("precondition: the same series on a clean row prints a finite figure in every one of those cells", () => {
    const { container } = mount(build());
    expect(firstStrat(container, RETURNS)).not.toBe(dash);
    for (const label of RETURNS_ROWS) expect(strat(container, RETURNS, label), label).not.toBe(dash);
    for (const label of ["3 Month", "6 Month", "Year-to-date", "1 Year"]) {
      expect(strat(container, CUMULATIVE, label), label).not.toBe(dash);
    }
  });

  it("Returns: month, YTD, 3M, 6M and 1Y read the em-dash in the strategy column", () => {
    const { container } = mount(build(WITHHELD));
    expect(firstStrat(container, RETURNS)).toBe(dash);
    for (const label of RETURNS_ROWS) expect(strat(container, RETURNS, label), label).toBe(dash);
  });

  it("Cumulative Return Metrics: the trailing windows, Since Inception and CAGR all read the em-dash", () => {
    // The read path nulls the seven stored scalars; the build nulls the seven windows.
    const NULL_SEVEN = {
      cumulative_return: null,
      volatility: null,
      max_drawdown: null,
      cagr: null,
      sharpe: null,
      sortino: null,
      calmar: null,
    };
    const p = buildFactsheetPayload(STRATEGY, rows, {
      benchmarkPrices: prices,
      dataQuality: WITHHELD,
      metricsByBasis: { cash_settlement: NULL_SEVEN },
    });
    if (!p) throw new Error("fixture must build");
    const { container } = mount({ ...p, activeComparator: "btc" });
    for (const label of ["3 Month", "6 Month", "Year-to-date", "1 Year", "Since Inception", "CAGR"]) {
      expect(strat(container, CUMULATIVE, label), label).toBe(dash);
    }
    expect(firstStrat(container, CUMULATIVE)).toBe(dash);
  });

  it("a Dated row is unchanged: its month window is still the suffix figure, not the em-dash", () => {
    const { container } = mount(build(DATED));
    expect(firstStrat(container, RETURNS)).not.toBe(dash);
  });
});

describe("a clean row and a selected range read what they read before this plan (T-164.6.6.3.3-22)", () => {
  it("a clean row's headline benchmark cells are the whole-record comparator, and no summarySince exists", () => {
    const p = build();
    expect("summarySince" in p.comparators.btc).toBe(false);
    const { container } = mount(p);
    expect(headlineBenchCells(container)).toEqual(expectedHeadline(oracle(p)));
  });

  it("a Dated payload's selected range reads exactly what the same series reads on a clean payload", async () => {
    const range = [100, 299] as const;
    // Inside a range the trailing rows are hidden; the rows that remain are the windowed view's.
    const rangeCells = (c: HTMLElement) => ({
      cum: bench(c, MAIN, "Cumulative Return"),
      cagr: bench(c, MAIN, "CAGR"),
      vol: bench(c, MAIN, "Ann. Volatility"),
      sharpe: bench(c, MAIN, "Sharpe"),
      sortino: bench(c, MAIN, "Sortino"),
      calmar: bench(c, MAIN, "Calmar"),
      maxdd: bench(c, MAXDD, "Max Drawdown"),
      win: bench(c, RETURNS, "Win Rate (days)"),
      pf: bench(c, RETURNS, "Profit Factor"),
      ldd: bench(c, MAXDD, "Longest DD (days)"),
    });
    const clean = mount(build(), range);
    await selectRange();
    expect(clean.container.textContent).toContain("hidden while a range is selected");
    const want = rangeCells(clean.container);
    clean.unmount();

    const dated = mount(build(DATED), range);
    await selectRange();
    expect(dated.container.textContent).toContain("hidden while a range is selected");
    expect(rangeCells(dated.container)).toEqual(want);
    // Guard against a vacuous pass: the range cells are real figures, not dashes.
    expect(want.cum).not.toBe(dash);
    expect(want.maxdd).not.toBe(dash);
  });

  it("the Dated payload's whole-record bench figures (summary) are untouched by the span summary", () => {
    const dated = build(DATED);
    const clean = build();
    expect(dated.comparators.btc.summary).toEqual(clean.comparators.btc.summary);
    expect(dated.comparators.spx.summary).toEqual(clean.comparators.spx.summary);
  });

  it("the span reaches only the cash bundle: a re-derived window and the MTM bundle carry no summarySince", () => {
    const built = buildFactsheetPayload(STRATEGY, rows, {
      benchmarkPrices: prices,
      dataQuality: DATED,
      mtmSeries: { dailyReturns: rows, gapSpans: [] },
    });
    if (!built) throw new Error("fixture must build");
    // Control: the cash bundle does carry it.
    expect("summarySince" in built.comparators.btc).toBe(true);
    expect("summarySince" in built.comparators.spx).toBe(true);
    const mtm = built.seriesByBasis?.mark_to_market;
    if (!mtm) throw new Error("fixture must carry an MTM bundle");
    expect("summarySince" in mtm.comparators.btc).toBe(false);
    expect("summarySince" in mtm.comparators.spx).toBe(false);
    const w = windowView(built, 100, 299);
    expect("summarySince" in w.comparators.btc).toBe(false);
    expect("summarySince" in w.comparators.spx).toBe(false);
  });
});
