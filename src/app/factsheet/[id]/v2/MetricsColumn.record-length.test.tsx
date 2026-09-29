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
