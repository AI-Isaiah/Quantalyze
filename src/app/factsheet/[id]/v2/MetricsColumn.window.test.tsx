import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import { formatRecordLength } from "@/lib/factsheet/record-length";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { MetricsColumn, isoToMonthDay } from "./MetricsColumn";
import { windowView } from "./basis-context";

/**
 * Phase 169.1 plan 02 (SC10, D-27) — the metrics rail follows the zoom window.
 *
 * The rail's window-dependent figures (Main Metrics, Compound Performance, Win
 * Rate / Profit Factor, Max Drawdown, Best / Worst Period, Worst 10, Extended
 * Metrics, the Bootstrap CI and §IV) must describe the range the charts show,
 * from the same windowed view the KPI strip reads, or the page shows two spans
 * under one eyebrow. The rows anchored to the RECORD's last date (the month row,
 * YTD, 3M, 6M, 1Y, and the whole Cumulative Return Metrics panel) cannot describe
 * a window, so they step aside while a range is selected, with one sentence
 * saying why; the per-calendar-year panels stay full history and say so.
 */

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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const STRATEGY = {
  id: "s-169-1-02-rail",
  name: "Window Rail Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

/** A 400-day record starting `start`, BTC closes covering every interval. */
function build400(start = "2024-01-01"): FactsheetPayload {
  const n = 400;
  const rows: DailyReturn[] = Array.from({ length: n }, (_, i) => ({
    date: addDays(start, i),
    value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
  }));
  const btc: DailyPrice[] = Array.from({ length: n + 1 }, (_, i) => ({
    date: addDays(start, i - 1),
    close: 40000 * (1 + 0.15 * Math.sin(i * 0.05)) + ((i * 37) % 11) * 120,
  }));
  const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  const payload = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt });
  if (!payload) throw new Error("fixture must build a payload");
  return payload;
}

/** Ends on the pinned "today" (2026-09-30): its month row reads Month-to-date. */
const openRecord = () => build400(addDays("2026-09-30", -399));
/** Ended 2025-02-03: its month row reads "Final month (Feb 2025)" (170-13). */
const endedRecord = () => build400("2024-01-01");

function RangeHarness({ range }: { range: readonly [number, number] }) {
  const { setXRange, resetXRange } = useXRange();
  return (
    <>
      <button data-testid="zoom" onClick={() => setXRange(range)}>zoom</button>
      <button data-testid="reset" onClick={() => resetXRange()}>reset</button>
    </>
  );
}

function mount(payload: FactsheetPayload, range: readonly [number, number] = [100, 299]) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <RangeHarness range={range} />
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

async function click(testId: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

function panel(title: string): HTMLElement | null {
  const h = [...document.querySelectorAll("h3")].find((el) => el.textContent === title);
  return (h?.closest("section") as HTMLElement | null) ?? null;
}

/** The text of every cell in the row whose first cell is `label`. Fails loud. */
function row(title: string, label: string): string[] {
  const p = panel(title);
  if (!p) throw new Error(`no panel titled "${title}"`);
  const tr = [...p.querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
  if (!tr) throw new Error(`no row "${label}" in "${title}"`);
  return [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "");
}

// MetricsColumn's own number rendering.
const pct = (v: number | null | undefined, signed = false) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const x = v * 100;
  return `${signed && x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
};
const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(2));

const TRAILING_LABEL = /^(Month-to-date|Last month \(.*\)|Final month \(.*\)|Year-to-date|3 Month|6 Month|1 Year)$/;

describe("the metrics rail follows the zoom window (SC10, D-27)", () => {
  it("Main Metrics, Compound Performance, Returns, Max Drawdown, Best / Worst, Extended and §IV read the windowed view", async () => {
    const payload = endedRecord();
    mount(payload);
    const w = windowView(payload, 100, 299);
    const wm = w.strategyMetrics;
    expect(row("Main Metrics", "Sharpe")[1]).toBe(num(payload.strategyMetrics.sharpe));

    await click("zoom");
    expect(row("Main Metrics", "Sharpe")[1]).toBe(num(wm.sharpe));
    expect(row("Main Metrics", "CAGR")[1]).toBe(pct(wm.cagr, true));
    expect(row("Main Metrics", "Ann. Volatility")[1]).toBe(pct(wm.ann_vol));
    expect(row("Main Metrics", "Sharpe")[2]).toBe(num(w.comparators.btc.summary?.sharpe));
    expect(row("Main Metrics", "Sharpe")[1]).not.toBe(num(payload.strategyMetrics.sharpe));
    expect(row("Max Drawdown", "Max Drawdown")[1]).toBe(`${(wm.max_dd * 100).toFixed(2)}%`);
    expect(row("Best / Worst Period", "Day").slice(1)).toEqual([pct(wm.best_day, true), pct(wm.worst_day, true)]);
    expect(row("Returns", "Win Rate (days)")[1]).toBe(pct(wm.win_rate));
    expect(row("Returns", "Profit Factor")[1]).toBe(num(wm.profit_factor));
    expect(row("Extended Metrics", "P5 (daily)")[1]).toBe(pct(w.quantiles.p05, true));
    expect(row("Extended Metrics", "P95 (daily)")[1]).toBe(pct(w.quantiles.p95, true));
    expect(row("Joint Metrics", "Beta")[1]).toBe(num(w.comparators.btc.joint?.beta));
    expect(row("Compound Performance", "Start Date")[1]).toBe(isoToMonthDay(payload.dates[100]));
    expect(row("Compound Performance", "End Date")[1]).toBe(isoToMonthDay(payload.dates[299]));
    expect(row("Compound Performance", "Years Observed")[1]).toBe(formatRecordLength({ n: wm.n, years: wm.years }).years);
    expect(row("Bootstrap 95% Confidence", "Sharpe")[1]).toBe(num(w.bootstrapCI.sharpe.point));
  });

  it("Worst 10 Drawdowns lists only drawdowns inside the window", async () => {
    const payload = endedRecord();
    mount(payload);
    await click("zoom");
    const p = panel("Worst 10 Drawdowns");
    expect(p).not.toBeNull();
    const lo = payload.dates[100];
    const hi = payload.dates[299];
    const bodyRows = [...p!.querySelectorAll("tbody tr")];
    expect(bodyRows.length).toBeGreaterThan(0);
    for (const r of bodyRows) {
      const tds = [...r.querySelectorAll("td")].map((td) => td.textContent ?? "");
      for (const d of tds.slice(1, 4)) {
        expect(d >= lo && d <= hi, `${d} inside ${lo}..${hi}`).toBe(true);
      }
    }
  });

  it("Rolling Metrics summarises the full-history rolling arrays over the window's indices only", async () => {
    const payload = endedRecord();
    mount(payload);
    const full = row("Rolling Metrics (6mo)", "Sharpe");
    await click("zoom");
    const arr = payload.strategyRollingSharpe.slice(100, 300).filter((v): v is number => v != null && Number.isFinite(v));
    const now = payload.strategyRollingSharpe[299];
    const want = [
      num(now),
      num(arr.reduce((a, b) => a + b, 0) / arr.length),
      num(Math.min(...arr)),
      num(Math.max(...arr)),
    ];
    const got = row("Rolling Metrics (6mo)", "Sharpe").slice(1);
    expect(got).toEqual(want);
    expect(got).not.toEqual(full.slice(1));
  });

  it.each([
    ["an open record", openRecord],
    ["an ended record", endedRecord],
  ] as const)("on %s, the record-anchored rows and the Cumulative Return Metrics panel are hidden while zoomed, with one sentence", async (_name, make) => {
    const payload = make();
    mount(payload);
    const keyed = () => document.querySelectorAll("[data-window-key]").length;
    const labels = () =>
      [...(panel("Returns")?.querySelectorAll("tr td:first-child") ?? [])].map((td) => td.textContent ?? "");
    expect(keyed()).toBeGreaterThan(0);
    expect(labels().some((l) => TRAILING_LABEL.test(l))).toBe(true);
    expect(panel("Cumulative Return Metrics")).not.toBeNull();
    expect(screen.queryByTestId("window-trailing-note")).toBeNull();

    await click("zoom");
    expect(keyed()).toBe(0);
    expect(labels().filter((l) => TRAILING_LABEL.test(l))).toEqual([]);
    expect(panel("Cumulative Return Metrics")).toBeNull();
    expect(screen.getByTestId("window-trailing-note").textContent).toBe(
      "The trailing and since-inception returns end on the record's last date, so they are hidden while a range is selected; resetting the range shows them.",
    );
  });

  it("EOY Returns, Calmar by Year and §III Style say Full history only while a range is selected", async () => {
    const payload = endedRecord();
    mount(payload);
    expect(screen.queryAllByTestId("scope-note")).toHaveLength(0);
    await click("zoom");
    const notes = screen.getAllByTestId("scope-note");
    expect(notes.map((n) => n.textContent)).toEqual(["Full history", "Full history", "Full history"]);
    const owners = notes.map((n) => n.closest("section")?.querySelector("h2, h3")?.textContent);
    expect(owners).toEqual(expect.arrayContaining(["EOY Returns", "Calmar by Year", "Style"]));
  });

  it("the rail eyebrow names the range, after the Strategy Thesis and before §I", async () => {
    const payload = endedRecord();
    mount(payload);
    const eyebrow = () => screen.getByTestId("range-eyebrow-rail");
    expect(eyebrow().textContent).toBe(
      `Full history: ${isoToMonthDay(payload.dates[0])} – ${isoToMonthDay(payload.dates[399])}`,
    );
    const sectionI = [...document.querySelectorAll("span")].find((s) => s.textContent === "§I");
    expect(sectionI).toBeDefined();
    expect(eyebrow().compareDocumentPosition(sectionI!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await click("zoom");
    expect(eyebrow().textContent).toBe(
      `Selected range: ${isoToMonthDay(payload.dates[100])} – ${isoToMonthDay(payload.dates[299])}`,
    );
  });

  it("after a reset every rail cell and row reads exactly as before the zoom", async () => {
    const payload = openRecord();
    const { container } = mount(payload);
    const before = container.querySelector("aside")!.innerHTML;
    await click("zoom");
    expect(container.querySelector("aside")!.innerHTML).not.toBe(before);
    await click("reset");
    expect(container.querySelector("aside")!.innerHTML).toBe(before);
  });

  it("§IV names the RANGE's paired count when a window pairs fewer than the floor (D-85)", async () => {
    const payload = endedRecord();
    mount(payload, [100, 107]);
    expect(screen.queryByTestId("joint-floor-reason")).toBeNull();
    await click("zoom");
    expect(screen.getByTestId("joint-floor-reason").textContent).toBe(
      "Alpha and beta need at least 10 days paired with BTC; the selected range has 8.",
    );
  });

  it("a withheld window (no annualization basis) shows no full-history figure anywhere on the rail (W1)", async () => {
    const base = endedRecord();
    const noBasis = { ...base } as Record<string, unknown>;
    delete noBasis.periodsPerYear;
    const payload = noBasis as unknown as FactsheetPayload;
    mount(payload);
    const cells: Array<[string, string]> = [
      ["Main Metrics", "Sharpe"],
      ["Main Metrics", "CAGR"],
      ["Main Metrics", "Cumulative Return"],
      ["Max Drawdown", "Max Drawdown"],
      ["Max Drawdown", "Longest DD (days)"],
      ["Extended Metrics", "P5 (daily)"],
      ["Extended Metrics", "P95 (daily)"],
      ["Bootstrap 95% Confidence", "Sharpe"],
      ["Bootstrap 95% Confidence", "Max Drawdown"],
    ];
    const fullText = cells.map(([t, l]) => row(t, l)[1]);
    expect(panel("Worst 10 Drawdowns")).not.toBeNull();

    await click("zoom");
    cells.forEach(([t, l], i) => {
      const v = row(t, l)[1];
      expect(v, `${t} / ${l}`).toBe("—");
      expect(v).not.toBe(fullText[i]);
    });
    expect(row("Bootstrap 95% Confidence", "Sharpe")[2]).toBe("[—, —]");
    expect(panel("Worst 10 Drawdowns")).toBeNull();
    expect(row("Compound Performance", "Start Date")[1]).toBe(isoToMonthDay(base.dates[100]));
    expect(row("Compound Performance", "End Date")[1]).toBe(isoToMonthDay(base.dates[299]));
    expect(panel("Bootstrap 95% Confidence")!.textContent).not.toMatch(/resamples/);
  });
});
