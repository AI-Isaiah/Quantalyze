import { describe, it, expect } from "vitest";
import { computeOgHeadline } from "./og-metrics";

// A day in ms, for building calendar-spaced date axes.
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

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
    const rows = consecutive(300, 0.001);
    const { sharpe, cagr } = computeOgHeadline(rows, "crypto");
    expect(Number.isFinite(sharpe)).toBe(true); // Sharpe still shown
    expect(Number.isNaN(cagr)).toBe(true); // CAGR hidden — sub-calendar-year
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
    const rows = consecutive(29, 0.01);
    const { sharpe, cagr, maxDd } = computeOgHeadline(rows, "crypto");
    expect(Number.isNaN(sharpe)).toBe(true);
    expect(Number.isNaN(cagr)).toBe(true);
    expect(Number.isNaN(maxDd)).toBe(true);
  });

  it("single / duplicate / unsorted dates never produce Infinity", () => {
    // All-same date (zero calendar span) → CAGR NaN, never ±Infinity.
    const same = Array.from({ length: 40 }, () => ({
      date: "2023-06-01",
      value: 0.002,
    }));
    const r1 = computeOgHeadline(same, "crypto");
    expect(Number.isFinite(r1.sharpe)).toBe(true);
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
