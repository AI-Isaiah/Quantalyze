import { describe, it, expect } from "vitest";
import { computeOgHeadline } from "./og-metrics";

// A day in ms, for building calendar-spaced date axes.
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * N consecutive-day rows alternating +0.002 / -0.001: real dispersion and a
 * positive drift, so a Sharpe EXISTS and only a gate can hide it. Phase 166.2
 * review round 1 (IN-03): two Sharpe arms below ran on constant fixtures, which
 * have no Sharpe at all since the shared floor (D-07 / D7), so one lost its
 * "Sharpe still shown" intent and the other's "hidden below 30" arm held
 * whether or not the gate existed.
 */
function alternating(n: number, startMs = Date.parse("2023-01-01")): Array<{ date: unknown; value: number }> {
  return Array.from({ length: n }, (_, i) => ({
    date: iso(startMs + i * DAY),
    value: i % 2 === 0 ? 0.002 : -0.001,
  }));
}

/** The stored headline keys the page's `storedCashHeadlineGate` requires (SFH-R2-01). */
const SEVEN_STORED = {
  cumulative_return: 0.4,
  volatility: 0.12,
  max_drawdown: -0.1,
  cagr: 0.6,
  sharpe: 1.5,
  sortino: 2.1,
  calmar: 3,
} as const;

/** N consecutive-day rows starting at `startMs`, each carrying `value`. */
function consecutive(
  n: number,
  value: number,
  startMs = Date.parse("2023-01-01"),
): Array<{ date: unknown; value: number }> {
  return Array.from({ length: n }, (_, i) => ({
    date: iso(startMs + i * DAY),
    value,
  }));
}

describe("computeOgHeadline — #597 OG headline metrics", () => {
  it("Sharpe rides the frequency clock: crypto / traditional ≈ √(365/252)", () => {
    // 40 alternating returns → nonzero variance, positive mean. Dates are
    // irrelevant to Sharpe, so a dense consecutive axis is fine here.
    const rows = Array.from({ length: 40 }, (_, i) => ({
      date: iso(Date.parse("2023-01-01") + i * DAY),
      value: i % 2 === 0 ? 0.02 : -0.01,
    }));
    const crypto = computeOgHeadline(rows, "crypto");
    const trad = computeOgHeadline(rows, "traditional");
    expect(Number.isFinite(crypto.sharpe)).toBe(true);
    expect(Number.isFinite(trad.sharpe)).toBe(true);
    expect(crypto.sharpe / trad.sharpe).toBeCloseTo(Math.sqrt(365 / 252), 10);
  });

  it("CAGR is asset-class-invariant (calendar clock): crypto == traditional", () => {
    // 55 weekly rows spanning ~378 days (> 1 calendar year), all positive → cum > 0.
    const rows = Array.from({ length: 55 }, (_, i) => ({
      date: iso(Date.parse("2023-01-01") + i * 7 * DAY),
      value: 0.003,
    }));
    const crypto = computeOgHeadline(rows, "crypto");
    const trad = computeOgHeadline(rows, "traditional");
    expect(Number.isFinite(crypto.cagr)).toBe(true);
    expect(Number.isFinite(trad.cagr)).toBe(true);
    // Same calendar span + same cumulative growth ⇒ identical CAGR regardless
    // of the annualization basis (CAGR has no periods-per-year term).
    expect(crypto.cagr).toBe(trad.cagr);
  });

  it("a dense 300-day crypto series shows a CAGR (194.1: no card-only year rule): the stored one when carried, else the computed calendar CAGR", () => {
    // 300 consecutive days spans 299 days. The card used to hide the CAGR of such a
    // series; whether a record is long enough to show annualized figures at all is
    // now the route's total-record gate, not this helper's.
    const rows = alternating(300);
    const stored = computeOgHeadline(rows, "crypto", {
      sharpe: 1.5,
      cagr: 0.2,
      max_drawdown: -0.1,
      computation_status: "complete",
    });
    expect(stored.cagr).toBe(0.2);

    // The computed fallback (stored key absent): 150 pairs of +0.2% then -0.1% compound to
    // (1.002 * 0.999)^150, over 299 elapsed days on the 365.25-day calendar clock.
    const { sharpe, cagr } = computeOgHeadline(rows, "crypto");
    expect(Number.isFinite(sharpe)).toBe(true);
    expect(Number.isFinite(cagr)).toBe(true);
    const expected = Math.pow(Math.pow(1.002 * 0.999, 150), 365.25 / 299) - 1;
    expect(cagr).toBeCloseTo(expected, 10);
  });

  it("a constant series has no Sharpe even with plenty of observations (D-07 floor, D7 '—')", () => {
    // 300 identical returns: no dispersion, so the Sharpe does not exist and the
    // card shows "—", never the ~1e16 residue ratio it showed before Phase 166.
    const { sharpe } = computeOgHeadline(consecutive(300, 0.001), "crypto");
    expect(Number.isNaN(sharpe)).toBe(true);
  });

  it("CAGR shown for a sparse-but-year-long weekday series", () => {
    // 40 rows, one per ~10 days, spanning ~390 days → the computed CAGR is
    // finite despite the sparse (non-daily) sampling.
    const rows = Array.from({ length: 40 }, (_, i) => ({
      date: iso(Date.parse("2023-01-02") + i * 10 * DAY),
      value: 0.004,
    }));
    const { cagr } = computeOgHeadline(rows, "traditional");
    expect(Number.isFinite(cagr)).toBe(true);
    expect(cagr).toBeGreaterThan(0);
  });

  it("CAGR hidden when cumulative growth is not strictly positive (cum ≤ 0)", () => {
    // A −100% day drives cumulative product to 0 → Math.pow(0, …) guard fires.
    const rows = consecutive(40, 0.005);
    rows[20] = { date: rows[20].date, value: -1 }; // wipeout day
    const { cagr } = computeOgHeadline(rows, "traditional");
    expect(Number.isNaN(cagr)).toBe(true);
  });

  it("no card-only observation floor (D-06): 29 dispersing rows still show Sharpe and Max DD, and the computed CAGR is finite (no card-only span rule)", () => {
    // The card used to hide Sharpe and Max DD below 30 observations while the
    // factsheet printed them, so one strategy read two ways. Any minimum-history
    // rule now belongs in compute, and the total-record minimum is the route's gate
    // (194 D-15). 29 consecutive days: 15 gains of +0.2% and 14 losses of -0.1%.
    const { sharpe, cagr, maxDd } = computeOgHeadline(alternating(29), "crypto");
    expect(Number.isFinite(sharpe)).toBe(true);
    expect(Number.isFinite(maxDd)).toBe(true);
    expect(maxDd).toBeLessThanOrEqual(0);
    const expected = Math.pow(Math.pow(1.002, 15) * Math.pow(0.999, 14), 365.25 / 28) - 1;
    expect(cagr).toBeCloseTo(expected, 8);
  });

  it("a pure call on fewer than two finite values returns no measured-looking Max DD", () => {
    // Dropping the observation gate must not turn "nothing to measure" into a 0.
    expect(Number.isNaN(computeOgHeadline([], "crypto").maxDd)).toBe(true);
    expect(Number.isNaN(computeOgHeadline([{ date: "2023-01-01", value: 0.01 }], "crypto").maxDd)).toBe(true);
    expect(Number.isNaN(computeOgHeadline([{ date: "2023-01-01", value: Number.NaN }], "crypto").maxDd)).toBe(true);
  });

  it("a computed CAGR that overflows is NaN, never Infinity (a huge gain over a one-day span)", () => {
    // 1e6 growth in one day annualizes to 1e6^365.25, past the largest double.
    const rows = [
      { date: "2023-01-01", value: 0.01 },
      { date: "2023-01-02", value: 1e6 },
    ];
    const { cagr } = computeOgHeadline(rows, "crypto");
    expect(Number.isNaN(cagr)).toBe(true);
  });

  it("single / duplicate / unsorted dates never produce Infinity", () => {
    // All-same date (zero calendar span) → CAGR NaN, never ±Infinity.
    const same = Array.from({ length: 40 }, () => ({
      date: "2023-06-01",
      value: 0.002,
    }));
    const r1 = computeOgHeadline(same, "crypto");
    // A constant series has no dispersion, so no Sharpe (D-07).
    expect(Number.isNaN(r1.sharpe)).toBe(true);
    expect(r1.cagr === Infinity || r1.cagr === -Infinity).toBe(false);
    expect(Number.isNaN(r1.cagr)).toBe(true);

    // Duplicated dates (two clusters) → span > 0 but well-defined, finite.
    const dup = Array.from({ length: 40 }, (_, i) => ({
      date: i < 20 ? "2023-01-01" : "2024-06-01",
      value: 0.001,
    }));
    const r2 = computeOgHeadline(dup, "traditional");
    expect(r2.cagr === Infinity || r2.cagr === -Infinity).toBe(false);
    expect(Number.isFinite(r2.cagr)).toBe(true); // spans > 1y, cum > 0

    // Unsorted dates → Math.min/max normalize order; result stays finite.
    const base = Array.from({ length: 40 }, (_, i) => ({
      date: iso(Date.parse("2023-01-01") + i * 12 * DAY),
      value: 0.003,
    }));
    const shuffled = [base[10], ...base.slice(1, 10), base[0], ...base.slice(11)];
    const r3 = computeOgHeadline(shuffled, "crypto");
    expect(r3.cagr === Infinity || r3.cagr === -Infinity).toBe(false);
    expect(Number.isFinite(r3.cagr)).toBe(true);
  });
});

/**
 * Phase 169.4.1 OGSHARPE (SC4, D-10, D-25): the card reads the PERSISTED CAGR,
 * Sharpe and max drawdown for a rankable row, so a shared card says what the
 * factsheet headline and every list say. Before this, the card recomputed them
 * from the raw series and could disagree with the stored values the lists rank
 * on. Since 164.6.6.3.3 (D-06) the card shows the stored Sharpe and max drawdown
 * with no card-only floor, and since 194.1 plan 06 it shows the stored CAGR at any
 * span too; its one named CAGR difference is E2 (a chain-broken or short-window
 * headline). A stored null hides, and a key the caller never projected (undefined)
 * falls back to the computation. A non-rankable row (a failed or computing run
 * still carries the previous run's scalars) is never read.
 */
describe("computeOgHeadline — persisted scalars for a rankable row (169.4.1)", () => {
  const STORED = { sharpe: 1.5, cagr: 0.2, max_drawdown: -0.1 } as const;

  it.each(["complete", "complete_with_warnings"])(
    "a %s row over a 400-day series shows exactly the stored figures",
    (status) => {
      const rows = alternating(400);
      const computed = computeOgHeadline(rows, "crypto");
      // Anti-vacuity: the computation over this series is finite and differs
      // from every stored value, so only the persisted arm can produce them.
      expect(Number.isFinite(computed.sharpe)).toBe(true);
      expect(Number.isFinite(computed.cagr)).toBe(true);
      expect(computed.sharpe).not.toBe(STORED.sharpe);
      expect(computed.cagr).not.toBe(STORED.cagr);
      expect(computed.maxDd).not.toBe(STORED.max_drawdown);

      const got = computeOgHeadline(rows, "crypto", { ...STORED, computation_status: status });
      expect(got).toEqual({ sharpe: 1.5, cagr: 0.2, maxDd: -0.1 });
    },
  );

  it("a 200-day series shows the STORED CAGR with the stored Sharpe and Max DD (194.1: no card-only year rule)", () => {
    const got = computeOgHeadline(alternating(200), "crypto", { ...STORED, computation_status: "complete" });
    expect(got).toEqual({ sharpe: 1.5, cagr: 0.2, maxDd: -0.1 });
  });

  it("a 20-observation series shows the stored Sharpe, max drawdown AND CAGR (no card-only floor, D-06; no span rule)", () => {
    const got = computeOgHeadline(alternating(20), "crypto", { ...STORED, computation_status: "complete" });
    expect(got).toEqual({ sharpe: 1.5, cagr: 0.2, maxDd: -0.1 });
  });

  it("B10: a stored CAGR shows on a 400-day row whose computed cumulative growth is not positive; a computed fallback stays NaN", () => {
    // A wipeout day drives the computed cumulative product to 0. The old rule hid
    // the STORED CAGR too, though the stored figure never touches that product.
    const rows = alternating(400);
    rows[200] = { date: rows[200].date, value: -1 };
    const stored = computeOgHeadline(rows, "crypto", { ...STORED, computation_status: "complete" });
    expect(stored.cagr).toBe(0.2);
    // The positive-growth guard protects only the power of a non-positive base,
    // which only the computed fallback (stored key absent) takes.
    const fallback = computeOgHeadline(rows, "crypto", { sharpe: 1.5, computation_status: "complete" });
    expect(Number.isNaN(fallback.cagr)).toBe(true);
  });

  it.each(["failed", "computing", null, undefined])(
    "a non-rankable row (status %s) never reads the stored scalars: the computed headline, unchanged",
    (status) => {
      const rows = alternating(400);
      const got = computeOgHeadline(rows, "crypto", { ...STORED, computation_status: status });
      expect(got).toEqual(computeOgHeadline(rows, "crypto"));
      expect(got.sharpe).not.toBe(STORED.sharpe);
    },
  );

  it("a stored null hides the figure (NaN), never the recomputed value", () => {
    const rows = alternating(400);
    const computed = computeOgHeadline(rows, "crypto");
    expect(Number.isFinite(computed.sharpe) && Number.isFinite(computed.cagr) && Number.isFinite(computed.maxDd)).toBe(true);
    const got = computeOgHeadline(rows, "crypto", {
      sharpe: null,
      cagr: null,
      max_drawdown: null,
      computation_status: "complete",
    });
    expect(Number.isNaN(got.sharpe)).toBe(true);
    expect(Number.isNaN(got.cagr)).toBe(true);
    expect(Number.isNaN(got.maxDd)).toBe(true);
  });

  it("an absent key (undefined, not projected) falls back to the computed value for that figure only", () => {
    const rows = alternating(400);
    const computed = computeOgHeadline(rows, "crypto");
    const got = computeOgHeadline(rows, "crypto", { sharpe: 1.5, computation_status: "complete" });
    expect(got.sharpe).toBe(1.5);
    expect(got.cagr).toBe(computed.cagr);
    expect(got.maxDd).toBe(computed.maxDd);
  });

  /**
   * Review round 1 CR-01 / SFH-01: the stored CAGR on a chain-broken row is
   * annualized over the suffix after the break only, while the card's own series
   * spans the whole 400-day record. A 45-day +6% suffix stores about
   * +60%; the card must not show it as if it covered the full record.
   */
  describe("a stored CAGR whose span the card cannot see is hidden (CR-01)", () => {
    // SFH-R2-01: the card asks the page's own applicability question, so a row
    // that stands for a stored headline carries all seven stored keys.
    const CHAIN_BROKEN_STORED = { ...SEVEN_STORED, sharpe: 1.5, cagr: 0.6, max_drawdown: -0.1, computation_status: "complete" } as const;

    it.each([
      ["twr_chain_broken", { twr_chain_broken: true, headline_since: "2023-02-01" }],
      ["insufficient_window", { insufficient_window: true }],
    ])("%s: the stored CAGR is hidden, the stored Sharpe and max drawdown still show", (_name, flags) => {
      const got = computeOgHeadline(alternating(400), "crypto", {
        ...CHAIN_BROKEN_STORED,
        data_quality_flags: flags,
      });
      expect(Number.isNaN(got.cagr)).toBe(true);
      expect(got.sharpe).toBe(1.5);
      expect(got.maxDd).toBe(-0.1);
    });

    it.each([
      ["absent", undefined],
      ["null", null],
      ["empty", {}],
      ["both false", { twr_chain_broken: false, insufficient_window: false }],
      ["a truthy non-boolean", { twr_chain_broken: "true" }],
    ])("negative control, flags %s: the stored CAGR still shows", (_name, flags) => {
      const got = computeOgHeadline(alternating(400), "crypto", {
        ...CHAIN_BROKEN_STORED,
        data_quality_flags: flags,
      });
      expect(got.cagr).toBe(0.6);
    });
  });

  /**
   * D-03 / D-06: a chain-broken row WITHOUT a valid `headline_since` is a legacy
   * mixed-basis row. The factsheet withholds all seven of its stored scalars
   * (`readHeadlineBasis`), so the card, which shows exactly the factsheet's value,
   * withholds the three it prints. Never the computed value in their place.
   */
  describe("a legacy chain-broken row (no valid headline_since) withholds every stored figure (D-03)", () => {
    const LEGACY = { ...SEVEN_STORED, sharpe: 1.5, cagr: 0.6, max_drawdown: -0.1, computation_status: "complete" } as const;

    it.each([
      ["absent", { twr_chain_broken: true }],
      ["null", { twr_chain_broken: true, headline_since: null }],
      ["malformed", { twr_chain_broken: true, headline_since: "2023-02-30" }],
    ])("headline_since %s: Sharpe, Max DD and CAGR are all NaN, not the computed values", (_name, flags) => {
      const rows = alternating(400);
      const computed = computeOgHeadline(rows, "crypto");
      expect(Number.isFinite(computed.sharpe) && Number.isFinite(computed.cagr) && Number.isFinite(computed.maxDd)).toBe(true);
      const got = computeOgHeadline(rows, "crypto", { ...LEGACY, data_quality_flags: flags });
      expect(Number.isNaN(got.sharpe)).toBe(true);
      expect(Number.isNaN(got.cagr)).toBe(true);
      expect(Number.isNaN(got.maxDd)).toBe(true);
    });

    it("a Dated row (valid headline_since) shows its stored Sharpe and Max DD; only the CAGR is withheld (E2)", () => {
      const got = computeOgHeadline(alternating(400), "crypto", {
        ...LEGACY,
        data_quality_flags: { twr_chain_broken: true, headline_since: "2023-02-01" },
      });
      expect(got.sharpe).toBe(1.5);
      expect(got.maxDd).toBe(-0.1);
      expect(Number.isNaN(got.cagr)).toBe(true);
    });
  });
});
