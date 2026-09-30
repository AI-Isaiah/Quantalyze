import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider } from "./factsheet-context";
import { AllocatorSection } from "./BatchDPanels";

/**
 * Phase 169.4 ALLOCTRUTH plan 06 (169.5 D-65, routed here; 169.4 D-70(4)): an
 * allocator portfolio whose blend has fewer than 2 usable days carries null
 * figures and a `through` date. The panel shows each figure as the em-dash and one
 * dated caption, never "0.0%" or "+0.00%" (DESIGN.md: a null is the em-dash, never
 * 0). A measured portfolio renders its figures as before.
 *
 * Both payloads come from `buildFactsheetPayload` on the api arm, so the null case
 * is the real one: a strategy dated after the SPX and IEF fixtures' last close
 * (2026-05-08) leaves 60/40, the first portfolio shown, with no priced day.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
const localStorageMock = {
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
};
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const STRATEGY = {
  id: "s-169-4-06-ui",
  name: "Null Honest Allocator",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

function rowsFrom(start: string, n: number): DailyReturn[] {
  return Array.from({ length: n }, (_, i) => ({ date: addDays(start, i), value: ((i % 7) - 3) / 1000 }));
}

function mount(payload: FactsheetPayload | null) {
  if (!payload || payload.ingestSource !== "api") throw new Error("fixture must build on the api arm");
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <AllocatorSection />
    </FactsheetProvider>,
  );
}

/** A zero figure as the panel would print it: "0%", "0.0%", "+0.00%", "-0.0%". */
const ZERO_FIGURE = /(^|[^0-9.])[+-]?0(\.0+)?%/;

describe("AllocatorSection: an unmeasurable blend is the em-dash with a dated caption (D-70(4))", () => {
  it("60/40 past its legs' last close: every figure cell is the em-dash, one caption dates the prices, no 0 figure anywhere", () => {
    const start = "2026-06-01";
    const btc: DailyPrice[] = Array.from({ length: 31 }, (_, i) => ({ date: addDays("2026-05-31", i), close: 90000 + ((i * 37) % 11) * 250 }));
    const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
    const payload = buildFactsheetPayload(STRATEGY, rowsFrom(start, 30), { benchmarkPrices: opt });
    const { container } = mount(payload);

    const values = Array.from(container.querySelectorAll("tbody tr td:nth-child(2)")).map(td => td.textContent);
    expect(values).toHaveLength(10);
    expect(values.every(v => v === "—")).toBe(true);

    const text = container.textContent ?? "";
    expect(text).toContain("Prices through May 8, 2026");
    expect(text.match(/Prices through/g)).toHaveLength(1);
    expect(text).not.toMatch(ZERO_FIGURE);
    expect(text).not.toContain("No stress windows");
    // No tail sentence for an unscanned blend ("During the null stress windows ...").
    expect(text).not.toContain("During the");
  });

  it("a measured 60/40 inside the fixtures renders its figures and no caption", () => {
    // Mon 2025-03-03 .. Fri 2025-05-16: every leg priced through the last date.
    const payload = buildFactsheetPayload(STRATEGY, rowsFrom("2025-03-03", 75));
    const { container } = mount(payload);
    const values = Array.from(container.querySelectorAll("tbody tr td:nth-child(2)")).map(td => td.textContent ?? "");
    expect(values).toHaveLength(10);
    expect(values.filter(v => v === "—")).toHaveLength(0);
    expect(values[0]).toMatch(/^\d+\.\d%$/);
    expect(container.textContent).not.toContain("Prices through");
  });

  it("a measured 60/40 too short for a 21-day window: the tail figures are the em-dash and the caption claims no drawdown fact (review SFH HIGH-2, WR-02)", () => {
    // Mon 2025-03-03, 20 days: 15 weekdays with every leg priced, no 21-date window.
    const payload = buildFactsheetPayload(STRATEGY, rowsFrom("2025-03-03", 20));
    const { container } = mount(payload);
    const values = Array.from(container.querySelectorAll("tbody tr td:nth-child(2)")).map(td => td.textContent ?? "");
    // Sleeve figures are measured; stress count is 0; mean, median, positive share are "—".
    expect(values[0]).toMatch(/^\d+\.\d%$/);
    expect(values.slice(6)).toEqual(["0", "—", "—", "—"]);
    const text = container.textContent ?? "";
    expect(text).toContain("No 21-day window with every leg priced, so no stress window could be measured.");
    expect(text).not.toContain("never drew");
    expect(text).not.toMatch(/\+0\.00%/);
  });
});
