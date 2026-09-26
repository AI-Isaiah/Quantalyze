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

  it("CAGR hidden (NaN) for a dense sub-year series (300 trading days < 0.95y)", () => {
    // 300 consecutive days spans ~299 days ≈ 0.82y < 0.95y → CAGR suppressed,
    // even though there are plenty of observations for Sharpe.
    const rows = alternating(300);
    const { sharpe, cagr } = computeOgHeadline(rows, "crypto");
    expect(Number.isFinite(sharpe)).toBe(true); // Sharpe still shown
    expect(Number.isNaN(cagr)).toBe(true); // CAGR hidden — sub-calendar-year
  });

  it("a constant series has no Sharpe even with plenty of observations (D-07 floor, D7 '—')", () => {
    // 300 identical returns: no dispersion, so the Sharpe does not exist and the
    // card shows "—", never the ~1e16 residue ratio it showed before Phase 166.
    const { sharpe } = computeOgHeadline(consecutive(300, 0.001), "crypto");
    expect(Number.isNaN(sharpe)).toBe(true);
  });

  it("CAGR shown for a sparse-but-year-long weekday series", () => {
    // 40 rows, one per ~10 days, spanning ~390 days > 0.95y → CAGR qualifies
    // despite the sparse (non-daily) sampling.
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

  it("Sharpe hidden (NaN) below the 30-observation floor", () => {
    // Dispersing rows, so the Sharpe is hidden by the observation gate alone:
    // the same fixture one row longer shows it.
    const { sharpe, cagr, maxDd } = computeOgHeadline(alternating(29), "crypto");
    expect(Number.isNaN(sharpe)).toBe(true);
    expect(Number.isNaN(cagr)).toBe(true);
    expect(Number.isNaN(maxDd)).toBe(true);
    expect(Number.isFinite(computeOgHeadline(alternating(30), "crypto").sharpe)).toBe(true);
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
