/** @vitest-environment jsdom */
/**
 * Phase 236 plan 11 (FIG-04, CONTEXT Q1): the factsheet states the span its CAGR covers, in one
 * muted line under the CAGR row.
 *
 * Why this matters: CAGR is annualized over first-to-last calendar days, so an allocator reading
 * "CAGR 31%" cannot tell whether that is 40 days or 4 years without the span. At full history the
 * span is the one the engine stored beside the CAGR (`cagr_start` / `cagr_end`, which on a Dated
 * row is the retained suffix, not the record); on a narrowed range it is the window's own first
 * and last dates, the same ones compute() used. A row stored before the keys existed shows nothing,
 * never invented text. Emptied stretches stay inside the span (Q1): the days are first-to-last, so
 * a hole in the middle is counted, not subtracted.
 *
 * Every expected string below is a literal, so a change of wording or of day count fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, fireEvent, act, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { BasisProvider, useBasis, type Basis } from "./basis-context";
import { MetricsColumn } from "./MetricsColumn";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
});

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const dayAt = (offset: number) => new Date(START + offset * DAY).toISOString().slice(0, 10);

const STRATEGY = {
  id: "s-236-11-span",
  name: "Span Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

function build(offsets: number[]): FactsheetPayload {
  const rows: DailyReturn[] = offsets.map((d, i) => ({
    date: dayAt(d),
    value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
  }));
  const payload = buildFactsheetPayload(STRATEGY, rows);
  if (!payload) throw new Error("fixture must build a payload");
  return payload;
}

/** 400 consecutive days: 2024-01-01 to 2025-02-03. */
const dense400 = () => build(Array.from({ length: 400 }, (_, i) => i));

function RangeHarness({ range }: { range: readonly [number, number] }) {
  const { setXRange } = useXRange();
  return <button data-testid="zoom" onClick={() => setXRange(range)}>zoom</button>;
}

function mount(payload: FactsheetPayload, range: readonly [number, number] = [100, 299]) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <RangeHarness range={range} />
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

const zoom = () => act(async () => void fireEvent.click(screen.getByTestId("zoom")));
const spanLine = (): string | null => document.querySelector('[data-testid="cagr-span"]')?.textContent ?? null;

describe("the CAGR span line (FIG-04, Q1)", () => {
  it("full history with the stored keys states the stored span under the CAGR row", () => {
    const payload = { ...dense400(), cagrStart: "2024-03-14", cagrEnd: "2025-11-02" };
    mount(payload);
    expect(spanLine()).toBe("CAGR over Mar\u00a014,\u00a02024 to Nov\u00a02,\u00a02025 (598 days)");
    // It sits directly under the CAGR row, in the same table.
    const cagrRow = [...document.querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === "CAGR");
    expect(cagrRow?.nextElementSibling?.querySelector('[data-testid="cagr-span"]')).not.toBeNull();
  });

  it("a row without the stored keys states the span of the CAGR it computed, never invented text (T-236-16, CR-03)", () => {
    mount(dense400());
    // No stored span describes this CAGR; it is compute()'s, over 2024-01-01 to 2025-02-03.
    expect(spanLine()).toBe("CAGR over Jan\u00a01,\u00a02024 to Feb\u00a03,\u00a02025 (399 days)");
  });

  it("a CAGR with no span (NaN years) reaches a cached page as null: no span line, no NaN or null text (C1, WR-05)", () => {
    const base = dense400();
    const cached = JSON.parse(
      JSON.stringify({ ...base, strategyMetrics: { ...base.strategyMetrics, years: NaN, cagr: NaN, calmar: NaN } }),
    ) as FactsheetPayload;
    expect(cached.strategyMetrics.years).toBeNull();
    expect(cached.strategyMetrics.cagr).toBeNull();
    mount(cached);
    expect(spanLine()).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN|null/);
  });

  it("a narrowed range states the window's own first and last dates, not the stored span", async () => {
    mount({ ...dense400(), cagrStart: "2024-03-14", cagrEnd: "2025-11-02" });
    await zoom();
    // Days 100..299 from 2024-01-01 are 2024-04-10 to 2024-10-26, 199 whole days.
    expect(spanLine()).toBe("CAGR over Apr\u00a010,\u00a02024 to Oct\u00a026,\u00a02024 (199 days)");
  });

  it("a narrowed range states its window even when the row has no stored keys", async () => {
    mount(dense400());
    await zoom();
    expect(spanLine()).toBe("CAGR over Apr\u00a010,\u00a02024 to Oct\u00a026,\u00a02024 (199 days)");
  });
});

describe("an emptied stretch stays inside the span (Q1)", () => {
  // Days 0..119 and 160..299 are observed: a 40-day hole, days 120..159.
  const offsets = [...Array.from({ length: 120 }, (_, i) => i), ...Array.from({ length: 140 }, (_, i) => 160 + i)];

  it("full history: the stored first-to-last span covers the 40 empty days", () => {
    mount({ ...build(offsets), cagrStart: "2024-01-01", cagrEnd: "2024-10-26" });
    // 2024-01-01 to 2024-10-26 is 299 days: the hole is counted, not 259 observed days.
    expect(spanLine()).toBe("CAGR over Jan\u00a01,\u00a02024 to Oct\u00a026,\u00a02024 (299 days)");
  });

  it("a range across the hole counts it: first to last observed day of the window", async () => {
    mount(build(offsets), [50, 200]);
    await zoom();
    // The window runs 2024-02-20 (day 50) to 2024-08-28 (day 240): 190 days, of which only 150
    // are observed. Counting observations (or subtracting the hole) would print 150.
    expect(spanLine()).toBe("CAGR over Feb\u00a020,\u00a02024 to Aug\u00a028,\u00a02024 (190 days)");
  });
});

/**
 * Review CR-03: Q1 says the factsheet states the span CAGR covers, and until this round only a
 * stored row with `cagr_start` did. Every surface below shows a CAGR and had no span line.
 */
describe("every shown CAGR states its span (CR-03)", () => {
  const SCALARS = { cumulative_return: 0.1, volatility: 0.2, max_drawdown: -0.05, cagr: 0.1, sharpe: 1, sortino: 1, calmar: 1 };

  function SetBasis({ basis }: { basis: Basis }) {
    const { setBasis } = useBasis();
    useEffect(() => {
      setBasis(basis);
    }, [basis, setBasis]);
    return null;
  }

  function mountOnBasis(payload: FactsheetPayload, basis: Basis) {
    return render(
      <FactsheetProvider payload={payload} persist={false}>
        <BasisProvider>
          <SetBasis basis={basis} />
          <MetricsColumn />
        </BasisProvider>
      </FactsheetProvider>,
    );
  }

  /** Cash: days 0..399. Mark-to-market: days 220..399 (marks began later). */
  function withMtm(extra: Partial<FactsheetPayload> = {}): FactsheetPayload {
    const row = (d: number, i: number): DailyReturn => ({
      date: dayAt(d),
      value: 0.0009 + Math.sin(i * 0.31) * 0.012,
    });
    const built = buildFactsheetPayload(
      STRATEGY,
      Array.from({ length: 400 }, (_, i) => row(i, i)),
      { mtmSeries: { dailyReturns: Array.from({ length: 180 }, (_, i) => row(220 + i, i)), gapSpans: [] } },
    );
    if (!built) throw new Error("fixture must build a payload");
    return {
      ...built,
      metricsByBasis: { mark_to_market: SCALARS },
      mtmGate: { available: true },
      ...extra,
    } as unknown as FactsheetPayload;
  }

  it("the mark-to-market basis states the MTM series' own span, not the stored cash span", () => {
    mountOnBasis(withMtm({ cagrStart: "2024-03-14", cagrEnd: "2025-11-02" }), "mark_to_market");
    // Days 220..399 are 2024-08-08 to 2025-02-03, 179 days. The cash span (598 days) describes a
    // different series and must not sit under this basis's CAGR.
    expect(spanLine()).toBe("CAGR over Aug\u00a08,\u00a02024 to Feb\u00a03,\u00a02025 (179 days)");
  });

  it("a stored cash headline with no stored keys (an older row) states the computed span", () => {
    mount({ ...dense400(), metricsByBasis: { cash_settlement: SCALARS } } as unknown as FactsheetPayload);
    expect(spanLine()).toBe("CAGR over Jan\u00a01,\u00a02024 to Feb\u00a03,\u00a02025 (399 days)");
  });

  it("a stored cash headline with no stored keys on a chain-broken record states nothing: its CAGR covers the suffix, not the record", () => {
    const base = dense400();
    mount({
      ...base,
      metricsByBasis: { cash_settlement: SCALARS },
      dataQuality: { ...base.dataQuality, twrChainBroken: true, headlineCoversFrom: "2024-03-14" },
    } as unknown as FactsheetPayload);
    expect(spanLine()).toBeNull();
    expect(document.body.textContent).not.toContain("CAGR over");
  });
});
