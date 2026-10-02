/** @vitest-environment jsdom */
/**
 * Phase 169.5 review round 1, SFH-M-06: regime shading stops at the comparator's
 * last rolling-Sharpe point and never runs over the dates it has no price for.
 *
 * Why this matters: with the regimes toggle on and BTC stored only through a date
 * before the strategy's end, BTC's rolling Sharpe is null past `through` (169.5
 * plan 02). The regime walk skipped those nulls but closed its final segment at
 * the SERIES end, so the chart shaded the whole uncovered tail as BTC's last
 * regime ("bull" or "bear") under a comparator line that had already stopped: a
 * market regime asserted for days with no BTC price.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { DailyPrice, DailyReturn } from "@/lib/factsheet/types";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { CHART_CONFIGS } from "./chart-configs";
import { FactsheetProvider } from "./factsheet-context";
import { TimeSeriesChart } from "./TimeSeriesChart";

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
  lsStore.clear();
  vi.stubGlobal("localStorage", localStorageMock);
  // The regimes toggle hydrates from the shared view-state URL (`reg=1`).
  window.history.replaceState(null, "", "/?reg=1");
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// 80 calendar days of a 7-day strategy; the rolling window falls back to 30.
const N = 80;
const DATES = Array.from({ length: N }, (_, i) => addDays("2025-01-01", i));
const ROWS: DailyReturn[] = DATES.map((date, i) => ({
  date,
  value: 0.01 * Math.sin(i * 1.1) + 0.004 * Math.cos(i * 0.37),
}));
/** BTC closes from the day before day one through strategy index `lastIdx`. */
function btc(lastIdx: number): DailyPrice[] {
  const out: DailyPrice[] = [];
  for (let j = -1; j <= lastIdx; j++) {
    out.push({ date: addDays(DATES[0], j), close: 50000 * (1 + 0.03 * Math.sin(j * 0.9) + 0.002 * j) });
  }
  return out;
}

function payloadThrough(lastIdx: number) {
  const prices = btc(lastIdx);
  const p = buildFactsheetPayload(
    { id: `rt-${lastIdx}`, name: "Regime Tail Fixture", types: [], markets: [], computedAt: "x", trustTier: null, assetClass: "crypto" },
    ROWS,
    { benchmarkPrices: { prices, through: prices[prices.length - 1].date, dropped: [] } },
  )!;
  expect(p.activeComparator).toBe("btc");
  return p;
}

/** Regime rects (fill positive/negative at 0.05 opacity) and the plot's x-extent. */
async function renderRegimes(lastIdx: number) {
  const payload = payloadThrough(lastIdx);
  const cfg = CHART_CONFIGS.find((c) => c.key === "cumulative")!;
  const { container, unmount } = render(
    <FactsheetProvider payload={payload}>
      <TimeSeriesChart config={cfg} />
    </FactsheetProvider>,
  );
  const regimeRects = () =>
    Array.from(container.querySelectorAll("rect")).filter(
      (r) => r.getAttribute("fill-opacity") === "0.05" && /--color-(positive|negative)/.test(r.getAttribute("fill") ?? ""),
    );
  await waitFor(() => expect(regimeRects().length).toBeGreaterThan(0));
  const clip = container.querySelector(`clipPath#plot-clip-${cfg.key} rect`)!;
  const left = Number(clip.getAttribute("x"));
  const plotW = Number(clip.getAttribute("width"));
  const right = Math.max(...regimeRects().map((r) => Number(r.getAttribute("x")) + Number(r.getAttribute("width"))));
  const rs = payload.comparators.btc.rollingSharpe!;
  let lastNonNull = -1;
  rs.forEach((v, i) => {
    if (v != null && Number.isFinite(v)) lastNonNull = i;
  });
  unmount();
  // X(i) = left + i / (N - 1) * plotW over the full default range.
  return { right, xLast: left + (lastNonNull / (N - 1)) * plotW, xEnd: left + plotW, lastNonNull };
}

describe("SFH-M-06 regime shading ends at the comparator's last covered point", () => {
  it("BTC through index 59 of 80: the rolling Sharpe ends at 59 and no regime band runs past it", async () => {
    const r = await renderRegimes(59);
    expect(r.lastNonNull).toBe(59);
    expect(r.right).toBeCloseTo(r.xLast, 6);
    expect(r.right).toBeLessThan(r.xEnd - 1);
  });

  it("full coverage: the shading still reaches the plot's right edge (unchanged)", async () => {
    const r = await renderRegimes(N - 1);
    expect(r.lastNonNull).toBe(N - 1);
    expect(r.right).toBeCloseTo(r.xEnd, 6);
  });
});
