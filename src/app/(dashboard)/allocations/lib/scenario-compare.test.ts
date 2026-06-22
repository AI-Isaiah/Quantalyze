import { describe, it, expect } from "vitest";
import type { DailyPoint } from "@/lib/scenario";
import type { ScenarioDraft, AddedStrategy } from "./scenario-state";
import {
  computeMetricsForDraft,
  buildLiveBookDraft,
  type ScenarioCompareInputs,
} from "./scenario-compare";

/**
 * TDD pins for the compare engine (Plan 23-03, Task 1).
 *
 * `computeMetricsForDraft(draft, liveInputs)` re-resolves a saved draft's
 * return series from the live payload and runs the FROZEN `computeScenario`
 * engine, returning the SAME `ComputedMetrics` the composer would show for
 * that draft over the same live inputs. The honesty invariants are encoded
 * as assertions, not prose:
 *
 *   1. A draft round-trips to real metrics over a healthy live book.
 *   2. A degenerate draft (overlap n below the engine's usable floor) yields
 *      NULL metric fields — the helper does NOT coerce to 0.
 *   3. Two drafts with heterogeneous overlap windows each report their OWN n.
 *   4. The synthetic live-book draft (all holdings enabled, equity-weight,
 *      no added strategies, no leverage) populates all six metrics non-null
 *      on a healthy live book.
 *   5. Every leg runs at leverage 1 (no leverage field consulted).
 *
 * Fixtures mirror `scenario.test.ts` style: business-day windows + a
 * constant/alternating return generator, fed through the SAME live-input
 * shape the composer builds (holdingsSummary + holdingReturnsByScopeRef +
 * the added-strategy lookups + symbolByHoldingId).
 */

// =========================================================================
// Fixture helpers (mirror scenario.test.ts)
// =========================================================================

/** N sequential business-day ISO dates starting at startDate (skips weekends). */
function buildDates(startDate: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(startDate + "T00:00:00Z");
  let i = 0;
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    i++;
    if (i > n * 3) break;
  }
  return out;
}

/** A holding scope_ref ("holding:{venue}:{symbol}:{holding_type}"). */
function holdingRef(venue: string, symbol: string, type: string): string {
  return `holding:${venue}:${symbol}:${type}`;
}

/** Alternating up/down daily-return window so vol/Sharpe/Sortino are non-zero. */
function altReturns(dates: string[], up: number, down: number): DailyPoint[] {
  return dates.map((date, i) => ({ date, value: i % 2 === 0 ? up : down }));
}

interface HoldingFixture {
  symbol: string;
  venue: string;
  holding_type: "spot" | "derivative";
  value_usd: number;
}

/**
 * Build the `ScenarioCompareInputs` (the live payload the composer holds):
 *   - holdingsSummary    — the live holdings (symbol/venue/type/value)
 *   - holdingReturnsByScopeRef — reconstructed per-holding series, keyed by ref
 *   - added* lookups     — empty here (own-book holdings only)
 *   - symbolByHoldingId  — ref → bare symbol (for the de-alias collapse)
 */
function liveInputs(
  holdings: HoldingFixture[],
  returnsByRef: Record<string, DailyPoint[]>,
): ScenarioCompareInputs {
  const symbolByHoldingId = new Map<string, string>();
  for (const h of holdings) {
    symbolByHoldingId.set(holdingRef(h.venue, h.symbol, h.holding_type), h.symbol);
  }
  return {
    holdingsSummary: holdings,
    holdingReturnsByScopeRef: returnsByRef,
    addedStrategyReturnsLookup: {},
    addedStrategyMetadataLookup: {},
    symbolByHoldingId,
  };
}

/** A minimal saved draft (current schema). Toggles/weights default empty so the
 *  adapter defaults (all holdings included, value-proportional) flow through. */
function draft(overrides: Partial<ScenarioDraft> = {}): ScenarioDraft {
  return {
    schema_version: 2,
    init_holdings_fingerprint: "fp",
    toggleByScopeRef: {},
    addedStrategies: [] as AddedStrategy[],
    weightOverrides: {},
    lastEditedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// =========================================================================
// Tests
// =========================================================================

describe("computeMetricsForDraft", () => {
  it("round-trips a saved draft to real metrics over a healthy live book", () => {
    const dates = buildDates("2024-01-02", 80);
    const holdings: HoldingFixture[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 6000 },
      { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 4000 },
    ];
    const returnsByRef = {
      [holdingRef("binance", "BTC", "spot")]: altReturns(dates, 0.01, -0.008),
      [holdingRef("binance", "ETH", "spot")]: altReturns(dates, 0.012, -0.009),
    };

    const m = computeMetricsForDraft(draft(), liveInputs(holdings, returnsByRef));

    expect(m.n).toBe(80);
    expect(m.twr).not.toBeNull();
    expect(m.cagr).not.toBeNull();
    expect(m.sharpe).not.toBeNull();
    expect(m.sortino).not.toBeNull();
    expect(m.max_drawdown).not.toBeNull();
    expect(m.volatility).not.toBeNull();
  });

  it("yields NULL metrics for a degenerate draft — never coerces to 0", () => {
    // Only 6 overlapping days — below the engine's n<10 usable floor, BUT the
    // adapter's warm-up gate (minReturnDays=30) drops a sub-30-day holding, so
    // we give a 6-day window AND lower nothing: the result is an empty active
    // set → engine returns null metrics with n=0.
    const shortDates = buildDates("2024-01-02", 6);
    const holdings: HoldingFixture[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 1000 },
    ];
    const returnsByRef = {
      [holdingRef("binance", "BTC", "spot")]: altReturns(shortDates, 0.01, -0.01),
    };

    const m = computeMetricsForDraft(draft(), liveInputs(holdings, returnsByRef));

    // Honesty invariant: the metric fields are NULL, not a fabricated 0.
    expect(m.twr).toBeNull();
    expect(m.cagr).toBeNull();
    expect(m.sharpe).toBeNull();
    expect(m.sortino).toBeNull();
    expect(m.volatility).toBeNull();
    expect(m.twr).not.toBe(0);
    expect(m.volatility).not.toBe(0);
  });

  it("two drafts with heterogeneous overlap windows each report their OWN n", () => {
    const longDates = buildDates("2024-01-02", 90);
    const shortDates = buildDates("2024-01-02", 60);
    const holdings: HoldingFixture[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 5000 },
    ];

    const longInputs = liveInputs(holdings, {
      [holdingRef("binance", "BTC", "spot")]: altReturns(longDates, 0.01, -0.008),
    });
    const shortInputs = liveInputs(holdings, {
      [holdingRef("binance", "BTC", "spot")]: altReturns(shortDates, 0.01, -0.008),
    });

    const mLong = computeMetricsForDraft(draft(), longInputs);
    const mShort = computeMetricsForDraft(draft(), shortInputs);

    // The helper does NOT force a common window — each reports its own n.
    expect(mLong.n).toBe(90);
    expect(mShort.n).toBe(60);
    expect(mLong.n).not.toBe(mShort.n);
  });

  it("ignores any leverage — every leg runs at leverage 1", () => {
    // A saved draft carries no leverage field. Even if a caller smuggles one
    // onto the draft object, the helper must never consult it: a 2x leg would
    // double the curve, so TWR with vs without the smuggled field must match.
    const dates = buildDates("2024-01-02", 80);
    const holdings: HoldingFixture[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 5000 },
    ];
    const inputs = liveInputs(holdings, {
      [holdingRef("binance", "BTC", "spot")]: altReturns(dates, 0.01, -0.008),
    });

    const base = computeMetricsForDraft(draft(), inputs);
    const smuggled = computeMetricsForDraft(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...draft(), leverage: { [holdingRef("binance", "BTC", "spot")]: 2 } } as any,
      inputs,
    );

    expect(smuggled.twr).toBe(base.twr);
    expect(smuggled.volatility).toBe(base.volatility);
  });
});

describe("buildLiveBookDraft", () => {
  it("produces an all-on, equity-weight draft so all six metrics populate", () => {
    const dates = buildDates("2024-01-02", 80);
    const holdings: HoldingFixture[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 6000 },
      { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 4000 },
    ];
    const returnsByRef = {
      [holdingRef("binance", "BTC", "spot")]: altReturns(dates, 0.01, -0.008),
      [holdingRef("binance", "ETH", "spot")]: altReturns(dates, 0.012, -0.009),
    };
    const inputs = liveInputs(holdings, returnsByRef);

    const liveDraft = buildLiveBookDraft();
    // No added strategies, no leverage on the synthetic draft.
    expect(liveDraft.addedStrategies).toHaveLength(0);

    const m = computeMetricsForDraft(liveDraft, inputs);
    expect(m.n).toBe(80);
    expect(m.twr).not.toBeNull();
    expect(m.cagr).not.toBeNull();
    expect(m.sharpe).not.toBeNull();
    expect(m.sortino).not.toBeNull();
    expect(m.max_drawdown).not.toBeNull();
    expect(m.volatility).not.toBeNull();
  });

  it("a genuinely degenerate live book still renders null (honest em-dash), not a 0", () => {
    // A live book with a single sub-warm-up holding → empty active set → null.
    const shortDates = buildDates("2024-01-02", 6);
    const holdings: HoldingFixture[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 1000 },
    ];
    const inputs = liveInputs(holdings, {
      [holdingRef("binance", "BTC", "spot")]: altReturns(shortDates, 0.01, -0.01),
    });

    const m = computeMetricsForDraft(buildLiveBookDraft(), inputs);
    expect(m.sharpe).toBeNull();
    expect(m.sharpe).not.toBe(0);
  });
});
