/**
 * 194 D-17 (review SFH-M1) — a stored annualised KPI always has its return series.
 *
 * `scripts/seed-demo-data.ts` upserted cagr / sharpe / sortino / volatility / calmar
 * into `strategy_analytics` with no `returns_series`. A row like that makes the
 * figure gate's record-length check unknowable, so the factsheet printed the
 * figures with no length caption. The seeder now writes the cumulative curve the
 * KPIs were computed from, beside them.
 *
 * Two arms, because the seeder's `main()` cannot run under vitest (the M-0846
 * entry-point guard): the generator is called directly, and the upsert payload is
 * source-scanned so a later edit that drops the key from the write goes red.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { STRATEGY_PROFILES, generateAnalytics } from "../../scripts/seed-demo-data";
import { ONE_YEAR_DAYS, figureRecord, gateAnnualized } from "@/lib/figure-gate";

const ANNUALISED_KPIS = ["cagr", "sharpe", "sortino", "volatility", "calmar"] as const;

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/seed-demo-data.ts"),
  "utf8",
);

describe("seed-demo-data pairs every stored KPI with its return series (D-17)", () => {
  it("generates a non-empty, dated cumulative series for every profile", () => {
    expect(STRATEGY_PROFILES.length).toBeGreaterThan(0);
    STRATEGY_PROFILES.forEach((profile, i) => {
      const a = generateAnalytics(profile, 1000 + i);
      for (const k of ANNUALISED_KPIS) {
        expect(Number.isFinite(a[k]), `${profile.name} ${k}`).toBe(true);
      }
      expect(a.returns_series.length, profile.name).toBeGreaterThan(0);
      for (const p of a.returns_series) {
        expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isFinite(p.value)).toBe(true);
      }
      // The curve is the one the KPIs came from: it ends at 1 + cumulative_return.
      expect(a.returns_series[a.returns_series.length - 1].value).toBeCloseTo(
        1 + a.cumulative_return,
        10,
      );
    });
  });

  it("review WR-05 / D-20: every demo series covers a full year (365 daily returns), so the demo shows no short-track note", () => {
    STRATEGY_PROFILES.forEach((profile, i) => {
      const { returns_series: s } = generateAnalytics(profile, 1000 + i);
      const record = figureRecord({
        seriesStart: s[0].date,
        seriesEnd: s[s.length - 1].date,
        observations: s.length,
        periodsPerYear: 365,
      });
      expect(s.length, profile.name).toBe(ONE_YEAR_DAYS);
      expect(record.spanDays, profile.name).toBe(ONE_YEAR_DAYS);
      expect(gateAnnualized(record), profile.name).toBe("full");
    });
  });

  it("the strategy_analytics upsert names returns_series beside the KPIs", () => {
    const write = SRC.match(
      /from\("strategy_analytics"\)\.upsert\(\{[\s\S]*?\},\s*\{\s*onConflict:\s*"strategy_id"/,
    );
    expect(write, "strategy_analytics upsert not found").not.toBeNull();
    const body = write![0];
    expect(body).toMatch(/\bcagr:/);
    expect(body).toMatch(/\breturns_series:\s*analytics\.returns_series/);
  });
});
