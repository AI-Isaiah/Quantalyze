/** @vitest-environment jsdom */
/**
 * Phase 169 D-12 / D-25 (SC5): MetricsColumn states the record length ONE way,
 * on the calendar clock, at "Years Observed" and in the Main Metrics warning.
 *
 * Why this matters: the warning used to state the length as the observation
 * count divided by the payload's periodsPerYear. On a dense calendar-daily record
 * that happens to agree with the calendar, so it looked right. On a SPARSE
 * record it does not: 166 observations spread over 1.20 calendar years printed
 * "(0.45y)" in the warning while "Years Observed" two panels up said 1.20. An
 * allocator reading the page could not tell which was the record's length.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

import { formatRecordLength } from "@/lib/factsheet/record-length";

import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";
import { StrategyThesisPanel, TermsPanel } from "./MandatePanels";

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
const START = Date.UTC(2024, 0, 1);

/** `n` returns on the given day offsets from 2024-01-01. */
function series(offsets: number[]): { date: string; value: number }[] {
  return offsets.map((d, i) => ({
    date: new Date(START + d * DAY).toISOString().slice(0, 10),
    value: Math.sin(i / 7) * 0.01,
  }));
}

/** `n` consecutive calendar days. */
const dense = (n: number) => series(Array.from({ length: n }, (_, i) => i));

/** 166 observations spread evenly over 438 calendar days (438 / 365.25 = 1.1992). */
const sparse166 = () => series(Array.from({ length: 166 }, (_, i) => Math.round((i * 438) / 165)));

function payloadOf(points: { date: string; value: number }[], periodsPerYear: number): FactsheetPayload {
  const built = buildFactsheetPayload(
    {
      id: "record-length-test",
      name: "Record Length Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-29T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    points,
  );
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  return { ...built, periodsPerYear } as FactsheetPayload;
}

function renderColumn(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

function section(container: HTMLElement, title: string): HTMLElement {
  const h = [...container.querySelectorAll("h3")].find((el) => el.textContent === title);
  if (!h) throw new Error(`no panel titled "${title}"`);
  return h.closest("section") as HTMLElement;
}

function rowValue(panel: HTMLElement, label: string): string {
  const tr = [...panel.querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
  if (!tr) throw new Error(`no row "${label}"`);
  return tr.querySelectorAll("td")[1]?.textContent ?? "";
}

function warningText(container: HTMLElement): string | null {
  const p = [...container.querySelectorAll("p")].find((el) => (el.textContent ?? "").includes("observations ("));
  return p ? (p.textContent ?? "").replace(/\s+/g, " ").trim() : null;
}

describe("MetricsColumn states the record length on the calendar clock (D-12)", () => {
  it("a dense 166-day record: Years Observed and the warning both state 0.45", () => {
    const payload = payloadOf(dense(166), 365);
    expect(payload.strategyMetrics.years.toFixed(2)).toBe("0.45");
    const { container } = renderColumn(payload);
    expect(rowValue(section(container, "Compound Performance"), "Years Observed")).toBe("0.45");
    const w = warningText(container);
    expect(w).not.toBeNull();
    expect(w).toContain("Only 166 observations (0.45y)");
  });

  it("a SPARSE record (166 observations over 1.20 calendar years): both sites state 1.20, never 166 / 365 = 0.45", () => {
    const payload = payloadOf(sparse166(), 365);
    expect(payload.strategyMetrics.n).toBe(166);
    expect(payload.strategyMetrics.years.toFixed(2)).toBe("1.20");
    const { container } = renderColumn(payload);
    expect(rowValue(section(container, "Compound Performance"), "Years Observed")).toBe("1.20");
    const w = warningText(container);
    expect(w).not.toBeNull();
    expect(w).toContain("Only 166 observations (1.20y)");
    expect(w).not.toContain("0.45");
  });

  it("the warning's threshold condition and 167.1.2's threshold sentence are unchanged on the sparse record", () => {
    const { container } = renderColumn(payloadOf(sparse166(), 365));
    expect(warningText(container)).toContain("Conventional reliability threshold is ≥ 365 observations (1 year).");
  });

  it("a record at or above the threshold count still shows no warning, however long it is on the calendar", () => {
    const { container } = renderColumn(payloadOf(dense(400), 365));
    expect(warningText(container)).toBeNull();
  });
});

/** The row labels of a panel, in render order. */
function rowLabels(panel: HTMLElement): string[] {
  return [...panel.querySelectorAll("tr")].map((r) => r.querySelector("td")?.textContent ?? "");
}

/** MetricsColumn's own percentage rendering (signed, two decimals, em-dash on non-finite). */
function pctSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const x = v * 100;
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

const cumulative = (container: HTMLElement) => section(container, "Cumulative Return Metrics");

/**
 * Phase 169 D-17 / D-02 / D-11 (SC6): the 3 Year and 5 Year rows read compute()'s
 * calendar windows and are NOT SHOWN when the record is shorter than the period.
 *
 * Why this matters: the rows used to clamp their look-back to the first
 * observation, so a 0.45-year record printed its whole-record return under a
 * "3 Year" label, and 800 daily points on a 24/7 venue (about 2.2 calendar
 * years) counted as three "years" of 252 observations. SC6 says the rows are not
 * shown, so the row is absent, not an em-dash.
 */
describe("Cumulative Return Metrics: 3 Year / 5 Year rows exist only when the record covers them (D-17)", () => {
  it("a 0.45-year record has no 3 Year and no 5 Year row; Since Inception is unchanged and the rows keep their order", () => {
    const payload = payloadOf(dense(166), 365);
    const panel = cumulative(renderColumn(payload).container);
    const labels = rowLabels(panel);
    expect(labels).not.toContain("3 Year");
    expect(labels).not.toContain("5 Year");
    expect(rowValue(panel, "Since Inception")).toBe(pctSigned(payload.strategyMetrics.cum_ret));
    const kept = ["Month-to-date", "3 Month", "Year-to-date", "Since Inception", "CAGR"];
    expect(labels.filter((l) => kept.includes(l))).toEqual(kept);
  });

  it("800 daily points (about 2.2 calendar years) have no 3 Year row: 3 years is 3 x 365 days, not 3 x 252 observations", () => {
    const payload = payloadOf(dense(800), 365);
    expect(payload.strategyMetrics.years).toBeLessThan(3);
    const labels = rowLabels(cumulative(renderColumn(payload).container));
    expect(labels).not.toContain("3 Year");
    expect(labels).not.toContain("5 Year");
  });

  it("a summary with p3y / p5y ABSENT (a hand-built summary) renders neither row", () => {
    const payload = payloadOf(dense(6 * 365 + 2), 365);
    const { p3y: _p3y, p5y: _p5y, ...rest } = payload.strategyMetrics;
    void _p3y;
    void _p5y;
    const labels = rowLabels(cumulative(renderColumn({ ...payload, strategyMetrics: rest }).container));
    expect(labels).not.toContain("3 Year");
    expect(labels).not.toContain("5 Year");
  });

  it("a 4-year record: 3 Year is compute()'s p3y and there is no 5 Year row", () => {
    const payload = payloadOf(dense(4 * 365 + 1), 365);
    const m = payload.strategyMetrics;
    expect(m.p3y).toEqual(expect.any(Number));
    expect(m.p5y).toBeNull();
    const panel = cumulative(renderColumn(payload).container);
    expect(rowValue(panel, "3 Year")).toBe(pctSigned(m.p3y));
    expect(rowLabels(panel)).not.toContain("5 Year");
  });

  it("a 6-year record: 3 Year and 5 Year are compute()'s p3y and p5y, neither the whole-record return", () => {
    const payload = payloadOf(dense(6 * 365 + 2), 365);
    const m = payload.strategyMetrics;
    expect(m.p3y).toEqual(expect.any(Number));
    expect(m.p5y).toEqual(expect.any(Number));
    expect(pctSigned(m.p3y)).not.toBe(pctSigned(m.cum_ret));
    const panel = cumulative(renderColumn(payload).container);
    expect(rowValue(panel, "3 Year")).toBe(pctSigned(m.p3y));
    expect(rowValue(panel, "5 Year")).toBe(pctSigned(m.p5y));
  });

  it("a non-finite p3y on a long record still renders the row, as the em-dash (hiding is only for a record shorter than the period)", () => {
    const payload = payloadOf(dense(4 * 365 + 1), 365);
    const panel = cumulative(
      renderColumn({ ...payload, strategyMetrics: { ...payload.strategyMetrics, p3y: Number.NaN } }).container,
    );
    expect(rowValue(panel, "3 Year")).toBe("—");
  });
});

/**
 * Phase 169 D-12 (SC5): the Strategy Thesis sentence and the Terms panel's Sample
 * size Term state the record length through the same formatter as MetricsColumn.
 * They used to say "N trading days" (wrong for a 24/7 venue) and "N days · Xy".
 */
describe("MandatePanels state the record length through formatRecordLength (D-12)", () => {
  function renderMandate(payload: FactsheetPayload) {
    return render(
      <FactsheetProvider payload={payload} persist={false}>
        <StrategyThesisPanel />
        <TermsPanel />
      </FactsheetProvider>,
    );
  }

  it("the thesis sentence and the Sample size Term state the same calendar length and daily-observation count", () => {
    const payload = payloadOf(sparse166(), 365);
    const expected = formatRecordLength({ n: payload.strategyMetrics.n, years: payload.strategyMetrics.years });
    expect(expected.text).toBe("1.20 years, 166 daily observations");
    const { container } = renderMandate(payload);

    const thesis = section(container, "Strategy Thesis");
    const thesisText = (thesis.textContent ?? "").replace(/\s+/g, " ");
    expect(thesisText).toContain(`(${expected.text})`);
    expect(thesisText).not.toContain("trading days");

    const dts = [...container.querySelectorAll("dt")];
    const sample = dts.find((dt) => dt.textContent === "Sample size");
    if (!sample) throw new Error("no Sample size Term");
    expect(sample.nextElementSibling?.textContent).toBe(expected.text);
  });
});
