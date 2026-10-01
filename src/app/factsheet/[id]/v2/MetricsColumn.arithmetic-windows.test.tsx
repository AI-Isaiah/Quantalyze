/** @vitest-environment jsdom */
/**
 * Phase 169.1 (D-31, plan 169.1-05): on a series stored with ARITHMETIC
 * compounding, the rail's calendar windows and its Best / Worst Month row are
 * the SUMS the engine computes, never compounded products.
 *
 * Why this matters: `compute_all_metrics` (analytics-service/services/metrics.py)
 * sums the returns after each window's cutoff under the `simple` method
 * (`_bucket_return` is `s.sum()`), and its monthly grid is summed per month.
 * The rail used to compound them, so on one page an arithmetic composite's
 * Month-to-date, Year-to-date and trailing rows disagreed with its own
 * headline, chart and engine figures.
 *
 * What does NOT change:
 *   - a series built without the method keeps the compounded figures it always
 *     showed (geometric is the default);
 *   - D-11's cutoffs and its coverage rule: a window the record does not cover
 *     renders exactly as it does under the geometric method (an em-dash row, or
 *     the 6 Month / 1 Year row omitted), under either method.
 *
 * The expected values are computed here, independently of compute(): a plain
 * sum (arithmetic) or a plain product (geometric) of the returns dated after
 * each D-11 cutoff. Every asserted row first checks that the two methods print
 * DIFFERENT strings for the fixture, so the test cannot pass under the wrong one.
 * The clock is faked (Date only) and the record ends in the current month, so the
 * month row is the "Month-to-date" row whatever day the suite runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload, type BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

import { FactsheetProvider } from "./factsheet-context";
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const DAY = 86_400_000;
const NOW = new Date("2026-09-30T12:00:00Z");
/** Mid-month of the pinned clock's month: an open record. */
const END_ISO = "2026-09-15";

type Daily = { date: string; value: number };

/**
 * `n` consecutive calendar-day returns ending on END_ISO (weekends included, so
 * D-11's strict "cutoff + one day" rule applies). Sized so a 15-day sum and a
 * 15-day product differ in the second decimal of a percentage.
 */
function dailies(n: number): Daily[] {
  const end = Date.parse(`${END_ISO}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(end - (n - 1 - i) * DAY).toISOString().slice(0, 10),
    value: Math.sin(i / 5) * 0.02 + 0.004,
  }));
}

function build(series: Daily[], opts?: BuildFactsheetOpts): FactsheetPayload {
  const built = buildFactsheetPayload(
    {
      id: "arithmetic-windows-test",
      name: "Arithmetic Windows Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-29T00:00:00Z",
      trustTier: null,
      ingestSource: "csv",
    },
    series,
    opts,
  );
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  expect(built.strategyMetrics.end).toBe(END_ISO);
  return built;
}

const ARITHMETIC: BuildFactsheetOpts = { cumulativeMethod: "arithmetic" };

function renderColumn(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

/** A panel by its h3 title. Throws (fails loud) if the mount does not render it. */
function section(container: HTMLElement, title: string): HTMLElement {
  const h = [...container.querySelectorAll("h3")].find((el) => el.textContent === title);
  if (!h) throw new Error(`no panel titled "${title}"`);
  return h.closest("section") as HTMLElement;
}

/** The strategy value of the Returns row carrying compute() field `key`, or null when the row is absent. */
function windowValue(container: HTMLElement, key: string): string | null {
  const row = section(container, "Returns").querySelector(`tr[data-window-key="${key}"]`);
  if (!row) return null;
  return row.querySelectorAll("td")[1]?.textContent ?? "";
}

/** The Best / Worst cells of the Best / Worst Period row for `scale`. */
function bwRow(container: HTMLElement, scale: string): { best: string; worst: string } {
  const rows = [...section(container, "Best / Worst Period").querySelectorAll("tbody tr")];
  const row = rows.find((r) => r.querySelector("td")?.textContent === scale);
  if (!row) throw new Error(`no Best / Worst row for ${scale}`);
  const tds = row.querySelectorAll("td");
  return { best: tds[1]?.textContent ?? "", worst: tds[2]?.textContent ?? "" };
}

/** MetricsColumn's own percentage rendering (signed, two decimals, em-dash on non-finite). */
function pctSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const x = v * 100;
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

/** D-11's cutoffs for a record ending END_ISO (UTC). */
function cutoffs(): Record<"mtd" | "ytd" | "p3m" | "p6m" | "p1y", Date> {
  const last = new Date(`${END_ISO}T00:00:00Z`);
  const back = (days: number) => new Date(last.getTime() - days * DAY);
  return {
    mtd: new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 0)),
    ytd: new Date(Date.UTC(last.getUTCFullYear() - 1, 11, 31)),
    p3m: back(90),
    p6m: back(182),
    p1y: back(365),
  };
}

const after = (series: Daily[], cutoff: Date) =>
  series.filter((d) => new Date(d.date) > cutoff).map((d) => d.value);
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const prod = (xs: number[]) => xs.reduce((a, x) => a * (1 + x), 1) - 1;

/** D-11: covered iff the first observation is on or before the cutoff plus one day. */
const covered = (series: Daily[], cutoff: Date) =>
  new Date(series[0].date).getTime() <= cutoff.getTime() + DAY;

/** Per-calendar-month aggregates, partial months included (compute()'s buckets). */
function monthAggregates(series: Daily[], agg: (xs: number[]) => number): number[] {
  const by = new Map<string, number[]>();
  for (const d of series) {
    const k = d.date.slice(0, 7);
    by.set(k, [...(by.get(k) ?? []), d.value]);
  }
  return [...by.values()].map(agg);
}

const WINDOW_KEYS = ["mtd", "ytd", "p3m", "p6m", "p1y"] as const;

describe("the rail's calendar windows follow the compounding method (Phase 169.1 D-31)", () => {
  const SERIES = dailies(800);

  it("the fixture discriminates: every window prints differently summed and compounded", () => {
    const c = cutoffs();
    for (const k of WINDOW_KEYS) {
      expect(covered(SERIES, c[k]), k).toBe(true);
      expect(pctSigned(sum(after(SERIES, c[k]))), k).not.toBe(pctSigned(prod(after(SERIES, c[k]))));
    }
    expect(pctSigned(Math.max(...monthAggregates(SERIES, sum)))).not.toBe(
      pctSigned(Math.max(...monthAggregates(SERIES, prod))),
    );
    expect(pctSigned(Math.min(...monthAggregates(SERIES, sum)))).not.toBe(
      pctSigned(Math.min(...monthAggregates(SERIES, prod))),
    );
  });

  it("arithmetic: Month-to-date, Year-to-date, 3 Month, 6 Month and 1 Year are the SUM after each D-11 cutoff; no 3 Year row", () => {
    const payload = build(SERIES, ARITHMETIC);
    expect(payload.cumulativeMethod).toBe("arithmetic");
    const { container } = renderColumn(payload);
    const c = cutoffs();
    for (const k of WINDOW_KEYS) {
      expect(windowValue(container, k), k).toBe(pctSigned(sum(after(SERIES, c[k]))));
    }
    // D-17: a record shorter than three years has no 3 Year row, under either method.
    expect(payload.strategyMetrics.p3y).toBeNull();
    expect(section(container, "Cumulative Return Metrics").textContent).not.toContain("3 Year");
  });

  it("arithmetic: the Best and Worst Month are the largest and smallest per-month SUM", () => {
    const { container } = renderColumn(build(SERIES, ARITHMETIC));
    const months = monthAggregates(SERIES, sum);
    expect(bwRow(container, "Month")).toEqual({
      best: pctSigned(Math.max(...months)),
      worst: pctSigned(Math.min(...months)),
    });
  });

  it("geometric (no method): every window and the Best / Worst Month stay the compounded figures", () => {
    const payload = build(SERIES);
    expect(payload.cumulativeMethod).toBeUndefined();
    const { container } = renderColumn(payload);
    const c = cutoffs();
    for (const k of WINDOW_KEYS) {
      expect(windowValue(container, k), k).toBe(pctSigned(prod(after(SERIES, c[k]))));
    }
    const months = monthAggregates(SERIES, prod);
    expect(bwRow(container, "Month")).toEqual({
      best: pctSigned(Math.max(...months)),
      worst: pctSigned(Math.min(...months)),
    });
  });

  it("D-11 coverage is unchanged under arithmetic: an uncovered YTD is an em-dash row, an uncovered 1 Year is omitted, a covered 6 Month is the sum", () => {
    // 200 days ending 15 Sep 2026 start on 28 Feb 2026: after the YTD cutoff
    // (31 Dec 2025) plus a day, after the 1 Year cutoff, before the 6 Month one.
    const short = dailies(200);
    const c = cutoffs();
    expect(covered(short, c.ytd)).toBe(false);
    expect(covered(short, c.p1y)).toBe(false);
    expect(covered(short, c.p6m)).toBe(true);
    const arith = renderColumn(build(short, ARITHMETIC)).container;
    const geom = renderColumn(build(short)).container;
    for (const container of [arith, geom]) {
      expect(windowValue(container, "ytd")).toBe("—");
      expect(windowValue(container, "p1y")).toBeNull();
    }
    expect(windowValue(arith, "p6m")).toBe(pctSigned(sum(after(short, c.p6m))));
    expect(windowValue(geom, "p6m")).toBe(pctSigned(prod(after(short, c.p6m))));
    expect(windowValue(arith, "p6m")).not.toBe(windowValue(geom, "p6m"));
  });
});
