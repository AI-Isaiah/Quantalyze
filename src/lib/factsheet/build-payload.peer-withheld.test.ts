import { describe, it, expect } from "vitest";
import { buildFactsheetPayload, type BuildFactsheetOpts } from "./build-payload";
import type { DailyReturn, FactsheetPayload } from "./types";

/**
 * Phase 164.6.6.3.3 plan 15 (D-15 extended again, T-164.6.6.3.3-38) — the page's actual path
 * for the Peer Percentile Max DD bar. A Withheld api row reaches the builder with the seven
 * headline scalars nulled by the read path (`applyHeadlineBasis`); `overlayBasisScalars` makes
 * each a NaN, and the builder ranks that NaN max_dd against the cohort. The rank must be
 * non-finite (the bar prints "—"), never a fabricated 0 ("0th").
 */
function isoDay(i: number): string {
  return new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
}

const SERIES: DailyReturn[] = Array.from({ length: 400 }, (_, i) => ({
  date: isoDay(i),
  value: Math.sin(i / 7) * 0.01 + 0.0004,
}));

const STRATEGY = {
  id: "peer-withheld-test",
  name: "Peer Withheld Test",
  types: ["test"],
  markets: ["crypto"],
  computedAt: "2026-09-29T00:00:00Z",
  trustTier: null,
  ingestSource: "api" as const,
  assetClass: "crypto",
};

/** What `applyHeadlineBasis` leaves on a Withheld row: every BASIS_KPI_MAP server key null. */
const REDACTED = {
  cumulative_return: null,
  volatility: null,
  max_drawdown: null,
  cagr: null,
  sharpe: null,
  sortino: null,
  calmar: null,
};
/** A rankable stored headline: finite scalars. */
const STORED = {
  cumulative_return: 0.2,
  volatility: 0.15,
  max_drawdown: -0.1,
  cagr: 0.18,
  sharpe: 1.2,
  sortino: 1.8,
  calmar: 1.8,
};

function build(dataQuality: BuildFactsheetOpts["dataQuality"], stored: Record<string, number | null>): FactsheetPayload {
  const p = buildFactsheetPayload(STRATEGY, SERIES, {
    dataQuality,
    metricsByBasis: { cash_settlement: stored },
  } as BuildFactsheetOpts);
  if (!p) throw new Error("fixture must build");
  return p;
}

function peer(p: FactsheetPayload) {
  if (p.ingestSource !== "api") throw new Error("premise: an api payload");
  if (!p.peerPercentile) throw new Error("premise: the api payload carries a peer percentile");
  return p.peerPercentile;
}

describe("a Withheld api payload's peer percentile (B36)", () => {
  it("premise: a rankable stored headline gives a finite Max DD rank", () => {
    const r = peer(build({ composite: false, insufficientWindow: false }, STORED));
    expect(Number.isFinite(r.max_dd)).toBe(true);
    expect(Number.isFinite(r.sharpe)).toBe(true);
  });

  it("a Withheld row's redacted max_dd has no rank, like its redacted Sharpe and Sortino", () => {
    const r = peer(
      build({ composite: false, insufficientWindow: false, twrChainBroken: true, headlineWithheld: true }, REDACTED),
    );
    expect(Number.isFinite(r.sharpe), "Sharpe (the guard that already existed)").toBe(false);
    expect(Number.isFinite(r.sortino), "Sortino (the guard that already existed)").toBe(false);
    expect(Number.isFinite(r.max_dd), "Max DD must not rank a redacted NaN as the 0th percentile").toBe(false);
  });
});
