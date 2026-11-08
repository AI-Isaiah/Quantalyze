import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { VAR_METHOD_LINE, shortTrackNote, coveredDays, withheldReason } from "@/lib/figure-gate";
import type { FigureRecord } from "@/lib/figure-gate";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";
import { pctSigned } from "./format";

/**
 * Phase 194 plan 04 (TRUST-05, D-04 as superseded by D-15, D-02, D-05) - the rail's ONE gate.
 *
 * The TOTAL record (`payload.figureRecord`) decides whether CAGR, Ann. Volatility,
 * Sharpe, Sortino and Calmar show; the window only qualifies them with one muted note
 * under a year. A selected range is never withheld for being short, and the same
 * record decides inside and outside a range. Each case below states the user-visible
 * reason it matters, so a rule change that keeps the test green is a rule change that
 * kept the behaviour.
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
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const STRATEGY = {
  id: "s-194-04-rail",
  name: "Figure Gate Rail Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

/** An n-day record, BTC closes covering every interval, with `figureRecord` set explicitly. */
function buildWith(n: number, record: FigureRecord | null, start = "2024-01-01", benchDays = n): FactsheetPayload {
  const rows: DailyReturn[] = Array.from({ length: n }, (_, i) => ({
    date: addDays(start, i),
    value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
  }));
  // `benchDays` < n: the comparator's prices start late (the last `benchDays` closes only).
  const btc: DailyPrice[] = Array.from({ length: benchDays + 1 }, (_, i) => ({
    date: addDays(start, n - benchDays + i - 1),
    close: 40000 * (1 + 0.15 * Math.sin(i * 0.05)) + ((i * 37) % 11) * 120,
  }));
  const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  const payload = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt });
  if (!payload) throw new Error("fixture must build a payload");
  return { ...payload, figureRecord: record };
}

const crypto = (spanDaysN: number): FigureRecord => ({ spanDays: spanDaysN, observations: null, crypto: true });
const nonCrypto = (spanDaysN: number, observations: number): FigureRecord => ({ spanDays: spanDaysN, observations, crypto: false });

function RangeHarness({ range }: { range: readonly [number, number] }) {
  const { setXRange } = useXRange();
  return (
    <button data-testid="zoom" onClick={() => setXRange(range)}>
      zoom
    </button>
  );
}

function mount(payload: FactsheetPayload, opts: { range?: readonly [number, number]; scenarioMode?: boolean } = {}) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <RangeHarness range={opts.range ?? [0, 1]} />
      <MetricsColumn scenarioMode={opts.scenarioMode} />
    </FactsheetProvider>,
  );
}

async function zoom() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("zoom"));
  });
}

function panel(title: string): HTMLElement {
  const h = [...document.querySelectorAll("h3")].find((el) => el.textContent === title);
  const p = h?.closest("section") as HTMLElement | null;
  if (!p) throw new Error(`no panel titled "${title}"`);
  return p;
}

function value(title: string, label: string): string {
  const tr = [...panel(title).querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
  if (!tr) throw new Error(`no row "${label}" in "${title}"`);
  return tr.querySelectorAll("td")[1]?.textContent ?? "";
}

const ANNUALISED = ["CAGR", "Ann. Volatility", "Sharpe", "Sortino", "Calmar"] as const;
const mainValues = () => ANNUALISED.map((l) => value("Main Metrics", l));
const note = () => document.querySelector('[data-testid="figure-gate-note"]');

describe("rail gate - the total record withholds (D-15)", () => {
  it("a crypto record of 60 days dashes all five annualised rows and names the bound and the days", () => {
    mount(buildWith(61, crypto(60)));
    expect(mainValues()).toEqual(["—", "—", "—", "—", "—"]);
    expect(note()?.textContent).toBe(
      "Annualized figures appear once the record reaches 90 days. This record covers 60 days.",
    );
  });

  it("a non-crypto record of 59 observations is withheld and the line names 60 trading days and 59", () => {
    mount(buildWith(120, nonCrypto(83, 59)));
    expect(mainValues()).toEqual(["—", "—", "—", "—", "—"]);
    expect(note()?.textContent).toContain("60 trading days");
    expect(note()?.textContent).toContain("59 trading days");
  });

  it("a non-crypto record of exactly 60 observations over 84 days shows its figures with the 84-day note (the bound is observations)", () => {
    mount(buildWith(120, nonCrypto(84, 60)));
    for (const v of mainValues()) expect(v).not.toBe("—");
    expect(note()?.textContent).toBe(shortTrackNote("record", 84));
  });
});

describe("rail gate - the window qualifies, it never withholds (D-15)", () => {
  it("a 200-day record shows its figures with the 200-day short-track note", () => {
    mount(buildWith(201, crypto(200)));
    for (const v of mainValues()) expect(v).not.toBe("—");
    expect(note()?.textContent).toBe(shortTrackNote("record", 200));
  });

  it("a 400-day record shows its figures with no note at all", () => {
    mount(buildWith(401, crypto(400)));
    for (const v of mainValues()) expect(v).not.toBe("—");
    expect(note()).toBeNull();
  });

  it("a 30-day range inside a 400-day record shows its figures with ONE range note (a range never withholds)", async () => {
    const payload = buildWith(401, crypto(400));
    mount(payload, { range: [100, 129] });
    await zoom();
    for (const v of mainValues()) expect(v).not.toBe("—");
    expect(document.querySelectorAll('[data-testid="figure-gate-note"]')).toHaveLength(1);
    expect(note()?.textContent).toBe(shortTrackNote("range", coveredDays(payload.dates[100], payload.dates[129])));
  });

  // 194 D-20: a selected range of 365 daily returns covers 365 days, a full year, so it carries no
  // note; one of 364 returns covers 364 days and does.
  it("a 365-row range inside a 500-day record carries no note, a 364-row range carries the 364-day note", async () => {
    const payload = buildWith(501, crypto(500));
    const full = mount(payload, { range: [10, 374] });
    await zoom();
    expect(coveredDays(payload.dates[10], payload.dates[374])).toBe(365);
    expect(note()).toBeNull();
    full.unmount();
    mount(payload, { range: [10, 373] });
    await zoom();
    expect(note()?.textContent).toBe(shortTrackNote("range", 364));
  });

  it("the same 30-day range inside a crypto 60-day record stays dashed with the RECORD reason (the total record decides)", async () => {
    const record = crypto(60);
    mount(buildWith(61, record), { range: [10, 39] });
    await zoom();
    expect(mainValues()).toEqual(["—", "—", "—", "—", "—"]);
    expect(note()?.textContent).toBe(withheldReason("record", record));
  });

  it("a 400-day range inside a 900-day record carries no note", async () => {
    mount(buildWith(901, crypto(900)), { range: [100, 499] });
    await zoom();
    for (const v of mainValues()) expect(v).not.toBe("—");
    expect(note()).toBeNull();
  });
});

describe("rail gate - the benchmark's own short span carries the muted note (D-16, round 2 WR-01)", () => {
  const benchNote = () => document.querySelector('[data-testid="bench-figure-gate-note"]');
  const benchCell = (label: string) => {
    const tr = [...panel("Main Metrics").querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
    return tr?.querySelectorAll("td")[2]?.textContent ?? "";
  };

  it("a two-year strategy beside a comparator covering 20 days shows the benchmark Sharpe WITH a note naming the benchmark and its span", () => {
    // Why: the benchmark cells are annualised over the comparator's own 20 days; a reader
    // seeing a Sharpe with no note takes it for a two-year figure (170.6 recorded SPX at 10.24).
    mount(buildWith(731, crypto(730), "2024-01-01", 20));
    expect(benchCell("Sharpe")).not.toBe("—");
    expect(note()).toBeNull(); // the strategy's own record is over a year
    const text = benchNote()?.textContent ?? "";
    expect(text).toMatch(/^BTC: CAGR, volatility, Sharpe, Sortino and Calmar are annualized from \d+ days of record, under one year\.$/);
  });

  it("a comparator covering the whole two-year record carries no benchmark note", () => {
    mount(buildWith(731, crypto(730)));
    expect(benchNote()).toBeNull();
  });

  it("D-19: a strategy record under the minimum dashes the benchmark cells and prints no benchmark note", () => {
    mount(buildWith(61, crypto(60), "2024-01-01", 20));
    expect(benchCell("Sharpe")).toBe("—");
    expect(benchNote()).toBeNull();
  });
});

describe("rail gate - Scenario blend wording (revision 3)", () => {
  it("scenarioMode with a 45-day crypto blend record reads the blend withheld reason, never the record wording", () => {
    const record = crypto(45);
    mount(buildWith(46, record), { scenarioMode: true });
    expect(note()?.textContent).toBe(withheldReason("blend", record));
    expect(note()?.textContent).not.toBe(withheldReason("record", record));
  });

  it("scenarioMode with a 200-day blend reads the blend short-track note", () => {
    mount(buildWith(201, crypto(200)), { scenarioMode: true });
    expect(note()?.textContent).toBe(shortTrackNote("blend", 200));
  });
});

describe("rail - the VaR method line (D-02) and magnitude (D-05)", () => {
  it("the method line is printed once under each VaR/CVaR block", () => {
    mount(buildWith(401, crypto(400)));
    const lines = [...document.querySelectorAll('[data-testid="var-method-line"]')];
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(l.textContent).toBe(VAR_METHOD_LINE);
    for (const title of ["Max Drawdown", "Extended Metrics"]) {
      expect(panel(title).querySelectorAll('[data-testid="var-method-line"]')).toHaveLength(1);
    }
  });

  it("a 13-digit cumulative return renders like any finite value: no extra element, no title", () => {
    const payload = buildWith(401, crypto(400));
    const huge = { ...payload, strategyMetrics: { ...payload.strategyMetrics, cum_ret: 1.2e13 } };
    mount(huge);
    expect(value("Main Metrics", "Cumulative Return")).toBe(pctSigned(1.2e13, 2));
    const tr = [...panel("Main Metrics").querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === "Cumulative Return")!;
    expect(tr.querySelector("[title]")).toBeNull();
    expect(tr.querySelectorAll("td")[1].children.length).toBeLessThanOrEqual(0);
  });
});

describe("rail - the amber observation sentence is gone", () => {
  it("a 30-observation record prints no confidence-interval warning", () => {
    mount(buildWith(31, crypto(30)));
    expect(document.body.textContent).not.toContain("wide statistical confidence intervals");
  });
});
