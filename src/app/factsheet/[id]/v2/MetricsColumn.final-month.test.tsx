/** @vitest-environment jsdom */
/**
 * Phase 170 (169-routed item (a), UI-SPEC AD-10): the month-to-date row of an
 * ENDED record names the record's last month.
 *
 * Why this matters: compute()'s `mtd` compounds the returns after the last day
 * of the month BEFORE the record's last month, so it is the return of the
 * record's final month. A record that stopped in June 2024 printed that figure
 * under "Month-to-date", which reads as this month's return on a live strategy.
 * The label now says `Final month (Jun 2024)` unless the record's last month is
 * the current UTC calendar month, when "Month-to-date" is true and stays.
 *
 * What does NOT change: the value (still `m.mtd`) and 169-05's em-dash lock (a
 * null `mtd` renders "—" in a row that is still shown, never an omitted row).
 * The clock is faked (Date only), so both branches are pinned on any run date.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

const DAY = 86_400_000;

/** `n` consecutive calendar-day returns ending on the given UTC date. */
function dailiesEnding(endIso: string, n: number): { date: string; value: number }[] {
  const end = Date.parse(`${endIso}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(end - (n - 1 - i) * DAY).toISOString().slice(0, 10),
    value: Math.sin(i / 7) * 0.01 + 0.0005,
  }));
}

function payloadEnding(endIso: string): FactsheetPayload {
  const built = buildFactsheetPayload(
    {
      id: "final-month-test",
      name: "Final Month Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-29T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    dailiesEnding(endIso, 120),
  );
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  expect(built.strategyMetrics.end).toBe(endIso);
  return built;
}

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

/** The first row's label and value: the month row leads both panels. */
function firstRow(panel: HTMLElement): { label: string; value: string } {
  const tds = panel.querySelector("tr")?.querySelectorAll("td");
  if (!tds) throw new Error("panel has no row");
  return { label: tds[0]?.textContent ?? "", value: tds[1]?.textContent ?? "" };
}

/** MetricsColumn's own percentage rendering (signed, two decimals, em-dash on non-finite). */
function pctSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const x = v * 100;
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

const PANELS = ["Returns", "Cumulative Return Metrics"] as const;
const FINAL_MONTH = /^Final month \([A-Z][a-z]{2} \d{4}\)$/;

describe("the month row names an ended record's last month (Phase 170, AD-10)", () => {
  it("a record whose last month is the current UTC month keeps 'Month-to-date' in both panels", () => {
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const payload = payloadEnding("2026-09-15");
    const { container } = renderColumn(payload);
    for (const title of PANELS) {
      const row = firstRow(section(container, title));
      expect(row.label, title).toBe("Month-to-date");
      expect(row.value, title).toBe(pctSigned(payload.strategyMetrics.mtd));
    }
  });

  it("a record that ended in June 2024 reads 'Final month (Jun 2024)' in both panels, with the same value", () => {
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const payload = payloadEnding("2024-06-08");
    expect(payload.strategyMetrics.mtd).toEqual(expect.any(Number));
    const { container } = renderColumn(payload);
    for (const title of PANELS) {
      const row = firstRow(section(container, title));
      expect(row.label, title).toBe("Final month (Jun 2024)");
      expect(row.label, title).toMatch(FINAL_MONTH);
      expect(row.value, title).toBe(pctSigned(payload.strategyMetrics.mtd));
    }
    expect(container.textContent).not.toContain("Month-to-date");
  });

  it("the month boundary is read in UTC: a record ending 31 Aug is 'Final month (Aug 2026)' from 00:30 UTC on 1 Sep", () => {
    vi.setSystemTime(new Date("2026-09-01T00:30:00Z"));
    const { container } = renderColumn(payloadEnding("2026-08-31"));
    for (const title of PANELS) expect(firstRow(section(container, title)).label, title).toBe("Final month (Aug 2026)");
  });

  it("the same record is still 'Month-to-date' at 23:30 UTC on 31 Aug", () => {
    vi.setSystemTime(new Date("2026-08-31T23:30:00Z"));
    const { container } = renderColumn(payloadEnding("2026-08-31"));
    for (const title of PANELS) expect(firstRow(section(container, title)).label, title).toBe("Month-to-date");
  });

  it("169-05's em-dash lock stays: a null mtd on an ended record keeps the row, value '—'", () => {
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const built = payloadEnding("2024-06-08");
    const payload: FactsheetPayload = { ...built, strategyMetrics: { ...built.strategyMetrics, mtd: null } };
    const { container } = renderColumn(payload);
    for (const title of PANELS) {
      const row = firstRow(section(container, title));
      expect(row.label, title).toBe("Final month (Jun 2024)");
      expect(row.value, title).toBe("—");
    }
  });

  it("a record with no end date (an empty summary) says 'Month-to-date', never an unparseable month", () => {
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const built = payloadEnding("2024-06-08");
    const payload: FactsheetPayload = { ...built, strategyMetrics: { ...built.strategyMetrics, end: "" } };
    const { container } = renderColumn(payload);
    for (const title of PANELS) expect(firstRow(section(container, title)).label, title).toBe("Month-to-date");
    expect(container.textContent).not.toMatch(/Final month \((undefined|NaN)/);
  });
});
