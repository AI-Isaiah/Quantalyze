import { describe, it, expect } from "vitest";
import {
  greeksReason,
  rollingAlphaBetaWhy,
  btcCorrelationWhy,
} from "./benchmark-why";
import {
  BENCHMARK_ROLLING_WINDOW_DAYS,
  CORRELATION_90D_MIN_DAYS,
} from "./min-history";

/**
 * Phase 170.5 plan 02 (D-01) — the rolling-window reason ladders. Each rung's
 * sentence is the UI-SPEC copy, verbatim. The order (native unit, benchmark
 * unavailable, short history, otherwise) is the contract: the first rung that
 * matches wins, so a native-unit strategy is never told it needs more history.
 */
describe("BENCHMARK_ROLLING_WINDOW_DAYS", () => {
  it("is the 90 paired intervals the Python worker windows over, and leaves the 250-day correlation floor alone", () => {
    expect(BENCHMARK_ROLLING_WINDOW_DAYS).toBe(90);
    expect(CORRELATION_90D_MIN_DAYS).toBe(250);
  });
});

describe("rollingAlphaBetaWhy", () => {
  it("rung 1: a native unit says the returns are not paired with BTC", () => {
    expect(
      rollingAlphaBetaWhy({ flags: { native_unit: "BTC" }, historyDays: 400 }),
    ).toBe("Not paired with BTC: returns are in BTC.");
  });

  it("rung 1 wins over rung 2 when both flags are set", () => {
    expect(
      rollingAlphaBetaWhy({
        flags: { native_unit: "BTC", benchmark_unavailable: true },
        historyDays: 400,
      }),
    ).toBe("Not paired with BTC: returns are in BTC.");
  });

  it("rung 2: benchmark prices unavailable", () => {
    expect(
      rollingAlphaBetaWhy({
        flags: { benchmark_unavailable: true },
        historyDays: 112,
      }),
    ).toBe(
      "BTC benchmark prices were unavailable when this strategy was last computed.",
    );
  });

  it("rung 3: 90 days of history is one short of the 91 a line needs", () => {
    expect(rollingAlphaBetaWhy({ flags: null, historyDays: 90 })).toBe(
      "Not enough history for the 90-day rolling window: needs 91 days paired with BTC; this strategy has 90 days of history.",
    );
  });

  it("rung 3: a brand-new strategy with no history prints 0 days and undefined flags are tolerated", () => {
    expect(rollingAlphaBetaWhy({ flags: undefined, historyDays: 0 })).toBe(
      "Not enough history for the 90-day rolling window: needs 91 days paired with BTC; this strategy has 0 days of history.",
    );
  });

  it("rung 4: 91 days of history and no flag falls through to the generic sentence", () => {
    expect(rollingAlphaBetaWhy({ flags: null, historyDays: 91 })).toBe(
      "Rolling alpha and beta are not computed for this strategy.",
    );
  });

  it("rung 4: empty flags and a long history", () => {
    expect(rollingAlphaBetaWhy({ flags: {}, historyDays: 400 })).toBe(
      "Rolling alpha and beta are not computed for this strategy.",
    );
  });

  it("T-170.5-04: a malformed native_unit never reaches the text and does not fire rung 1", () => {
    for (const bad of ["<b>x</b>", 42, "btc", "B", null]) {
      const out = rollingAlphaBetaWhy({
        // the flag is untrusted jsonb; cast mirrors the wire shape
        flags: { native_unit: bad } as never,
        historyDays: 400,
      });
      expect(out).toBe("Rolling alpha and beta are not computed for this strategy.");
    }
  });
});

describe("btcCorrelationWhy", () => {
  it("rung 1: a native unit", () => {
    expect(
      btcCorrelationWhy({ flags: { native_unit: "BTC" }, historyDays: 400 }),
    ).toBe("Not paired with BTC: returns are in BTC.");
  });

  it("rung 2: benchmark prices unavailable", () => {
    expect(
      btcCorrelationWhy({
        flags: { benchmark_unavailable: true },
        historyDays: 400,
      }),
    ).toBe(
      "BTC benchmark prices were unavailable when this strategy was last computed.",
    );
  });

  it("rung 3: short history", () => {
    expect(btcCorrelationWhy({ flags: null, historyDays: 60 })).toBe(
      "Not enough history for the 90-day rolling correlation: needs 91 days paired with BTC; this strategy has 60 days of history.",
    );
  });

  it("rung 4: otherwise", () => {
    expect(btcCorrelationWhy({ flags: null, historyDays: 400 })).toBe(
      "Rolling correlation with BTC is not computed for this strategy.",
    );
  });
});

/**
 * Phase 170.5 plan 07 Task 1 (D-07) - why a Benchmark greeks cell reads a dash.
 * Sentences are the UI-SPEC copy, verbatim (the em dash in the per-cell lines is
 * U+2014, the glyph the cell shows). First match wins; a dash never stands
 * alone; a computed strip with no dash needs no line.
 */
describe("greeksReason", () => {
  const NULLS = { alpha: null, beta: null, correlation: null, ir: null, treynor: null };
  const FULL = { alpha: 0.12, beta: 0.4, correlation: 0.5, ir: 0.3, treynor: 0.2 };

  it("native unit: the factsheet's own withheld sentence", () => {
    expect(greeksReason({ kind: "native_unit", unit: "BTC" }, NULLS)).toBe(
      "Not measurable: returns are in BTC. A BTC benchmark measured in BTC is a flat line.",
    );
  });

  it("benchmark unavailable", () => {
    expect(greeksReason({ kind: "benchmark_unavailable" }, NULLS)).toBe(
      "BTC benchmark prices are unavailable for this record.",
    );
  });

  it("below the paired floor: pairedFloorReason with the builder's own count", () => {
    expect(greeksReason({ kind: "below_floor", paired: 7, floor: 10 }, NULLS)).toBe(
      "Alpha and beta need at least 10 days paired with BTC; this record has 7.",
    );
  });

  it("not computed, and no status at all, with a dash", () => {
    expect(greeksReason({ kind: "not_computed" }, NULLS)).toBe(
      "Benchmark greeks are not computed for this strategy.",
    );
    expect(greeksReason(undefined, NULLS)).toBe(
      "Benchmark greeks are not computed for this strategy.",
    );
  });

  it("computed with no dash needs no line", () => {
    expect(
      greeksReason({ kind: "computed", paired: 111, flatLeg: false }, FULL),
    ).toBeNull();
    expect(greeksReason(undefined, FULL)).toBeNull();
  });

  it("a flat leg replaces every per-cell line", () => {
    expect(
      greeksReason(
        { kind: "computed", paired: 50, flatLeg: true },
        { ...FULL, correlation: null, ir: null },
      ),
    ).toBe("No dispersion in this record.");
  });

  it("all three per-cell causes are joined by a space in the order correlation, IR, Treynor", () => {
    expect(
      greeksReason(
        { kind: "computed", paired: 50, flatLeg: false },
        { ...FULL, correlation: null, ir: null, treynor: null },
      ),
    ).toBe(
      "Correlation reads — when either return series is flat. IR reads — when tracking error is zero. Treynor reads — when beta is zero.",
    );
  });

  it("a single null Treynor names only Treynor", () => {
    expect(
      greeksReason(
        { kind: "computed", paired: 50, flatLeg: false },
        { ...FULL, treynor: null },
      ),
    ).toBe("Treynor reads — when beta is zero.");
  });

  it("a NaN counts as a dash", () => {
    expect(
      greeksReason(
        { kind: "computed", paired: 50, flatLeg: false },
        { ...FULL, ir: Number.NaN },
      ),
    ).toBe("IR reads — when tracking error is zero.");
  });

  it("computed with a null alpha or beta and no flat leg falls back to not-computed (a dash never stands alone)", () => {
    expect(
      greeksReason(
        { kind: "computed", paired: 50, flatLeg: false },
        { ...FULL, alpha: null },
      ),
    ).toBe("Benchmark greeks are not computed for this strategy.");
    expect(
      greeksReason(
        { kind: "computed", paired: 50, flatLeg: false },
        { ...FULL, beta: null },
      ),
    ).toBe("Benchmark greeks are not computed for this strategy.");
  });

  it("error and needs_builder return null: the panel renders the retry banner instead", () => {
    expect(greeksReason({ kind: "error" }, NULLS)).toBeNull();
    expect(greeksReason({ kind: "needs_builder" }, NULLS)).toBeNull();
  });

  it("the em dash in the per-cell lines is U+2014", () => {
    const line = greeksReason(
      { kind: "computed", paired: 50, flatLeg: false },
      { ...FULL, correlation: null },
    )!;
    expect(line).toContain("—");
  });
});
