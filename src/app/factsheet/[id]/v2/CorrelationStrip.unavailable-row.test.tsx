/** @vitest-environment jsdom */
/**
 * Phase 169.5 review round 1, SFH-M-04: a benchmark whose correlation is not a
 * number keeps its row in the "Cross-Asset Correlation" strip and reads "—".
 *
 * Why this matters: when the BTC read fails (or BTC has fewer than two paired
 * intervals), BTC's rho is NaN. The strip used to FILTER such rows out, so it
 * silently showed one row fewer than the correlation matrix beside it, which
 * prints "—" for the same cell. With SPX or no comparator selected nothing on
 * the page said why BTC had left. The honest reading is the row, a "—", and no
 * bar: the matrix's own missing-value form.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { DailyPrice, FactsheetPayload } from "@/lib/factsheet/types";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider } from "./factsheet-context";
import { CorrelationStripPanel } from "./DistributionPanels";

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const DATES = Array.from({ length: 40 }, (_, i) => addDays("2025-01-01", i));
const STRAT = DATES.map((_, i) => 0.01 * Math.sin(i * 1.1) + 0.004 * Math.cos(i * 0.37));

const STRATEGY = {
  id: "s-169-5-sfh-m-04",
  name: "Correlation Strip Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

function payloadWith(prices: DailyPrice[]): FactsheetPayload {
  const p = buildFactsheetPayload(
    STRATEGY,
    DATES.map((date, i) => ({ date, value: STRAT[i] })),
    { benchmarkPrices: { prices, through: prices[prices.length - 1]?.date ?? null, dropped: [] } },
  );
  if (!p) throw new Error("fixture must build");
  return p;
}

function stripRows(payload: FactsheetPayload) {
  const { container, unmount } = render(
    <FactsheetProvider payload={payload} persist={false}>
      <CorrelationStripPanel />
    </FactsheetProvider>,
  );
  const groups = [...container.querySelectorAll("svg g")].filter(g => g.querySelectorAll("text").length === 2);
  const out = groups.map(g => {
    const t = g.querySelectorAll("text");
    return { name: t[0].textContent ?? "", rho: t[1].textContent ?? "", bars: g.querySelectorAll("rect").length };
  });
  unmount();
  return out;
}

describe("SFH-M-04 correlation strip: a non-finite rho keeps its row and reads the em-dash", () => {
  // Two BTC closes on the strategy's first two dates: at most one interval is
  // paired, so pairedCorr has fewer than two points and returns NaN.
  const sparse = () => payloadWith([
    { date: DATES[0], close: 100 },
    { date: DATES[1], close: 101 },
  ]);

  it("the fixture really yields a non-finite BTC rho (the precondition)", () => {
    const p = sparse();
    const btc = p.correlations.find(r => /BTC/i.test(r.name));
    expect(btc, "a BTC correlation row in the payload").toBeDefined();
    expect(Number.isFinite(btc!.rho)).toBe(false);
  });

  it("the strip shows every payload row, BTC included, as the matrix does", () => {
    const p = sparse();
    const rows = stripRows(p);
    expect(rows.map(r => r.name)).toEqual(p.correlations.map(r => r.name));
  });

  it("the BTC row reads '—' and draws no bar; the finite rows keep theirs", () => {
    const p = sparse();
    const rows = stripRows(p);
    const btc = rows.find(r => /BTC/i.test(r.name))!;
    expect(btc.rho).toBe("—");
    expect(btc.bars).toBe(0);
    const finite = p.correlations.filter(r => Number.isFinite(r.rho)).length;
    expect(finite).toBeGreaterThan(0);
    expect(rows.filter(r => r.bars === 1)).toHaveLength(finite);
  });
});
