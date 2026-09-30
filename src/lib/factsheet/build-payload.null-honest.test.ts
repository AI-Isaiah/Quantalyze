import { describe, it, expect } from "vitest";

/**
 * Phase 169.4 ALLOCTRUTH plan 05 (169.5 D-65, routed here; 169.4 D-70(1)): the api
 * arm's event signatures read the null-honest BTC alignment, so a missing BTC day
 * (a dropped close, a day past BTC's last close, day one without a prior close) is
 * a skipped event or a dropped trace, never a 0% day in SignaturePanels or
 * CrossSignaturePanels.
 *
 * The expected figures are computed here from `computeEventSignatures` on the
 * alignment `alignCoveredReturns` gives, and the 0-filled figures beside them prove
 * the case can tell the two apart (SC9: re-introducing the 0-fill turns it RED).
 */

import { buildFactsheetPayload } from "./build-payload";
import type { BenchmarkPricesOpt } from "./build-payload";
import { alignCoveredReturns, COMPARATOR_CALENDARS } from "./align";
import { computeEventSignatures } from "./event-signatures";
import { cumEq } from "./compute";
import type { DailyPrice, DailyReturn, EventSignaturesPayload } from "./types";

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const START = "2026-03-01";
const N = 80;
const DATES = Array.from({ length: N }, (_, i) => addDays(START, i));
const DROPPED = DATES[40];

/** Deterministic non-zero strategy returns, so every day is a win or a loss event. */
function strategyRows(): DailyReturn[] {
  let x = 20260930;
  return DATES.map((date) => {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    const v = Math.round((x / 0x7fffffff - 0.5) * 0.08 * 1e6) / 1e6;
    return { date, value: v === 0 ? 0.001 : v };
  });
}

/** Deterministic BTC closes from the day before the first date to the last date. */
function btcCloses(): DailyPrice[] {
  let x = 4242;
  let c = 60000;
  const out: DailyPrice[] = [];
  for (let i = -1; i < N; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    c = Math.round(c * (1 + (x / 0x7fffffff - 0.5) * 0.06) * 100) / 100;
    out.push({ date: addDays(START, i), close: c });
  }
  return out;
}

const STRATEGY = {
  id: "s-169-4-05",
  name: "Null Honest Signatures",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

const total = (s: EventSignaturesPayload | null | undefined) => {
  if (!s) throw new Error("signatures must be present on the api arm");
  return { h1: s.h1.winCount + s.h1.lossCount, h7: s.h7.winCount + s.h7.lossCount };
};

describe("169.4-05: the api arm's event signatures skip a missing BTC day (D-65, D-70(1))", () => {
  it("one dropped BTC close mid-series: payload counts equal the null-honest computation and are strictly below the 0-filled one", () => {
    const rows = strategyRows();
    const all = btcCloses();
    const prices = all.filter((p) => p.date !== DROPPED);
    const opt: BenchmarkPricesOpt = { prices, through: prices[prices.length - 1].date, dropped: [DROPPED] };
    const payload = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt });
    if (!payload || payload.ingestSource !== "api") throw new Error("fixture must build on the api arm");

    const strat = rows.map((r) => r.value);
    const al = alignCoveredReturns(prices, [DROPPED], DATES, COMPARATOR_CALENDARS.btc);
    // The dropped close nulls both intervals touching it, and nothing else.
    expect(al.returns.map((r, i) => (r === null ? i : -1)).filter((i) => i >= 0)).toEqual([40, 41]);
    const filled = al.returns.map((r) => r ?? 0);

    const honestStrat = computeEventSignatures(strat, al.returns, cumEq(strat));
    const zeroStrat = computeEventSignatures(strat, filled, cumEq(strat));
    const honestBench = computeEventSignatures(al.returns, al.returns, cumEq(filled));
    const zeroBench = computeEventSignatures(filled, filled, cumEq(filled));

    // Window-eligible events 14..65 (52); traces reading index 40 or 41 are 26..54 (29).
    expect(total(honestStrat).h1).toBe(52 - 29);
    expect(total(zeroStrat).h1).toBe(52);

    // SignaturePanels (strategy events, BTC traces).
    expect(total(payload.eventSignatures)).toEqual(total(honestStrat));
    expect(total(payload.eventSignatures).h1).toBeLessThan(total(zeroStrat).h1);
    expect(payload.eventSignatures!.h1.winOfBenchmark).toEqual(honestStrat.h1.winOfBenchmark);

    // CrossSignaturePanels (BTC's own events).
    expect(total(payload.benchEventSignatures)).toEqual(total(honestBench));
    expect(payload.benchEventSignatures!.h1.eligibleWinCount + payload.benchEventSignatures!.h1.eligibleLossCount).toBe(
      honestBench.h1.eligibleWinCount + honestBench.h1.eligibleLossCount,
    );
    expect(payload.benchEventSignatures!.h7.eligibleWinCount + payload.benchEventSignatures!.h7.eligibleLossCount).toBeLessThan(
      zeroBench.h7.eligibleWinCount + zeroBench.h7.eligibleLossCount,
    );
    expect(payload.benchEventSignatures!.h1.winOfEquity).toEqual(honestBench.h1.winOfEquity);
    expect(payload.benchEventSignatures!.h1.winOfEquity).not.toEqual(zeroBench.h1.winOfEquity);
  });
});
