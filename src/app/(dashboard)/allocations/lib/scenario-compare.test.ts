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
 * v1.5 PERSIST-03 adds the per-persisted-window compare pins:
 *   6. A draft with a `window` computes at that window — effective bounds are
 *      clamped to the window and members that do not cover it are dropped
 *      (member_count reflects window membership, distinct from the union).
 *   7. Two drafts with DIFFERENT windows compute independently (heterogeneous,
 *      never force-aligned to a shared window).
 *   8. The live-book draft (window omitted) + any windowless (v2) draft stay on
 *      the union path — byte-identical to today (Phase-55 own-book union lock).
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

  // =======================================================================
  // v1.5 PERSIST-03 — per-persisted-window compare (each draft at its OWN window)
  // WHY: compare must show 2+ scenarios each at its own SAVED coverage window.
  // Force-aligning them to a shared window would be dishonest — a member that
  // ended before another's window should not be silently stretched to it. The
  // engine already computes windowed metrics; these pin that computeMetricsForDraft
  // THREADS the persisted draft.window through to the engine (POST-collapse) so
  // the compare column is windowed, and that a windowless (v2 / live-book) draft
  // is unchanged from the union path (Phase-55 own-book lock).
  // =======================================================================

  it("a windowed draft narrows effective bounds to the window (distinct from the union)", () => {
    // Two holdings with DIFFERENT coverage spans:
    //   BTC — the full ~140-day span (2024-01-02 → ~2024-07-16)
    //   ETH — a LATE-starting span that begins ~2024-04-01, so the union spans
    //         BTC's full range while ETH only covers the later portion.
    // A window pinned to the LATER sub-range is covered by BOTH, so the windowed
    // blend keeps both members but its effective bounds are the window, NOT the
    // union's wider BTC-driven bounds.
    const btcDates = buildDates("2024-01-02", 140);
    const ethDates = buildDates("2024-04-01", 80);
    const holdings: HoldingFixture[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 5000 },
      { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 5000 },
    ];
    const inputs = liveInputs(holdings, {
      [holdingRef("binance", "BTC", "spot")]: altReturns(btcDates, 0.01, -0.008),
      [holdingRef("binance", "ETH", "spot")]: altReturns(ethDates, 0.012, -0.009),
    });

    // A window inside ETH's coverage (both members cover it).
    const window = { start: ethDates[10], end: ethDates[60] };

    const union = computeMetricsForDraft(draft(), inputs);
    const windowed = computeMetricsForDraft(draft({ window }), inputs);

    // The union path spans BTC's full range; the windowed path is clamped to the
    // window — its effective bounds differ from the union's (the window is honored).
    expect(union.effective_start).not.toBeNull();
    expect(windowed.effective_start).not.toBeNull();
    expect(windowed.effective_end).not.toBeNull();
    expect(windowed.effective_start).not.toBe(union.effective_start);
    // The windowed bounds fall within the requested window (engine reads state.window).
    expect(windowed.effective_start! >= window.start).toBe(true);
    expect(windowed.effective_end! <= window.end).toBe(true);
    // A shorter window means fewer trading days than the full union.
    expect(windowed.n).toBeLessThan(union.n);
  });

  it("a windowed draft drops members that do not cover the window (member_count reflects the window)", () => {
    // BTC covers the full range; ETH only covers a LATE sub-range. A window over
    // the EARLY range (before ETH exists) is covered by BTC ONLY → ETH is dropped
    // from the windowed blend, so member_count reflects window membership (< the
    // full selected set), while the union path counts both.
    const btcDates = buildDates("2024-01-02", 200);
    const ethDates = buildDates("2024-06-03", 60);
    const holdings: HoldingFixture[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 5000 },
      { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 5000 },
    ];
    const inputs = liveInputs(holdings, {
      [holdingRef("binance", "BTC", "spot")]: altReturns(btcDates, 0.01, -0.008),
      [holdingRef("binance", "ETH", "spot")]: altReturns(ethDates, 0.012, -0.009),
    });

    // An EARLY window — inside BTC's span but BEFORE ETH starts. Only BTC covers it.
    const earlyWindow = { start: btcDates[5], end: btcDates[70] };
    const windowed = computeMetricsForDraft(draft({ window: earlyWindow }), inputs);

    // ETH does not cover the early window → only 1 member survives the window.
    expect(windowed.member_count).toBe(1);
    expect(windowed.member_ids).toEqual([holdingRef("binance", "BTC", "spot")]);
  });

  it("two drafts with DIFFERENT windows compute independently (heterogeneous, not force-aligned)", () => {
    // The compare invariant: each column is at its OWN window. Two windows over
    // NON-OVERLAPPING sub-ranges of the same live book produce independent
    // effective bounds — neither is aligned to the other.
    const dates = buildDates("2024-01-02", 200);
    const holdings: HoldingFixture[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 5000 },
    ];
    const inputs = liveInputs(holdings, {
      [holdingRef("binance", "BTC", "spot")]: altReturns(dates, 0.01, -0.008),
    });

    const earlyWindow = { start: dates[5], end: dates[70] };
    const lateWindow = { start: dates[120], end: dates[190] };

    const early = computeMetricsForDraft(draft({ window: earlyWindow }), inputs);
    const late = computeMetricsForDraft(draft({ window: lateWindow }), inputs);

    // Each computes at its OWN window — the bounds are independent, NOT aligned.
    expect(early.effective_start).not.toBe(late.effective_start);
    expect(early.effective_end).not.toBe(late.effective_end);
    expect(early.effective_start! < late.effective_start!).toBe(true);
  });

  it("the live-book draft stays WINDOWLESS — its metrics are byte-identical to the union path (Phase-55 lock)", () => {
    // buildLiveBookDraft() omits `window` → the live-book column MUST run the
    // union path. This pins the Phase-55 own-book union lock: the live column's
    // metrics equal a windowless draft over the same book and are UNAFFECTED by
    // any window in the compare set.
    const dates = buildDates("2024-01-02", 120);
    const holdings: HoldingFixture[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 6000 },
      { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 4000 },
    ];
    const inputs = liveInputs(holdings, {
      [holdingRef("binance", "BTC", "spot")]: altReturns(dates, 0.01, -0.008),
      [holdingRef("binance", "ETH", "spot")]: altReturns(dates, 0.012, -0.009),
    });

    const liveDraft = buildLiveBookDraft();
    expect(liveDraft.window).toBeUndefined(); // never carries a window

    const live = computeMetricsForDraft(liveDraft, inputs);
    // A plain windowless draft over the same book is the union baseline.
    const unionBaseline = computeMetricsForDraft(draft(), inputs);

    // Byte-identical union behavior — effective bounds + n + twr all match.
    expect(live.effective_start).toBe(unionBaseline.effective_start);
    expect(live.effective_end).toBe(unionBaseline.effective_end);
    expect(live.n).toBe(unionBaseline.n);
    expect(live.twr).toBe(unionBaseline.twr);
  });

  it("a windowless (v2) draft is unchanged — no window key → union path (byte-identical to today)", () => {
    // A pre-v1.5 draft carries no `window` field. It must run the exact union
    // path it ran before Plan 03 — the window injection is inert when absent.
    const dates = buildDates("2024-01-02", 90);
    const holdings: HoldingFixture[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 5000 },
    ];
    const inputs = liveInputs(holdings, {
      [holdingRef("binance", "BTC", "spot")]: altReturns(dates, 0.01, -0.008),
    });

    const windowlessDraft = draft();
    expect(windowlessDraft.window).toBeUndefined();

    const m = computeMetricsForDraft(windowlessDraft, inputs);
    // Full union span, all trading days — nothing clamped.
    expect(m.n).toBe(90);
    expect(m.effective_start).not.toBeNull();
    expect(m.effective_end).not.toBeNull();
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
