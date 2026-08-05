/**
 * Phase 149 / 149-02 Task 2 — `scoreAgainstPopulation`, the ONE percentile
 * scoring core (FOUNDER RULING 2026-08-05, refined by W-A).
 *
 * The formula used to live inline inside `getPercentiles`. Two callers now need
 * it — the discovery surface (published rows scored against each other) and
 * /my-strategies (the owner's OWN rows, including drafts, scored against the
 * published population WITHOUT joining it). A second inline copy would drift,
 * so the formula was extracted here and both callers delegate.
 *
 * SCORING CONVENTION (W-A, binding): every subject is scored SELF-INCLUSIVELY —
 * its effective population is `population ∪ {subject}`, deduped BY IDENTITY (a
 * subject that already IS a population row is never double-added). Two
 * consequences that this spec pins:
 *
 *   1. `scoreAgainstPopulation(rows, rows)` reproduces the pre-extraction
 *      `getPercentiles` map byte-identically (every subject is already a
 *      member → effective population === population). `queries.percentiles.
 *      test.ts` is the untouched behaviour oracle for the INVERSION and
 *      MAGNITUDE arms; this file pins the FORMULA SHAPE the oracle cannot see
 *      (self-inclusion vs exclusion, dedupe, mixed-metric record shape).
 *   2. A draft gets "if published, this would sit at Pnn" LITERALLY — and it
 *      still cannot shift anyone else's rank, because self-inclusion is
 *      per-subject and the population array is never mutated.
 *
 * Expectations below are HAND-COMPUTED from the definition, never read back
 * from the implementation (Oracle Independence).
 */

import { describe, it, expect } from "vitest";
import { scoreAgainstPopulation, PERCENTILE_METRICS } from "./percentile-core";

type Row = { id: string; analytics: Record<string, number | null> };

/** A population row carrying a single metric; every other metric is null. */
function row(id: string, metric: string, value: number | null): Row {
  const analytics: Record<string, number | null> = {};
  for (const m of PERCENTILE_METRICS) analytics[m] = null;
  analytics[metric] = value;
  return { id, analytics };
}

describe("scoreAgainstPopulation — self-inclusion (W-A ruling)", () => {
  it("scores a DISTINCT subject against population ∪ {subject}", () => {
    // population sharpe = [1,2,3,4,5,6,7]; subject sharpe = 4, NOT a member.
    // effective population = 8 values; count(<= 4) = 4 population values + the
    // subject itself = 5 → 5/8*100 = 62.5 → 63.
    // An EXCLUSIVE scorer computes 4/7*100 = 57.14 → 57 and fails here.
    const population = [1, 2, 3, 4, 5, 6, 7].map((v, i) => row(`p${i}`, "sharpe", v));
    const subject = row("draft", "sharpe", 4);

    const map = scoreAgainstPopulation([subject], population);

    expect(map.draft.sharpe).toBe(63);
  });

  it("identity-dedupe: a subject that IS a population row is never double-added", () => {
    // subjects === population === [1,2,3,4,5]. Member "m2" (value 3) must score
    // 3/5*100 = 60. A double-adding implementation computes 4/6*100 = 66.67 →
    // 67 and fails here — and would silently change every published percentile
    // on discovery.
    const rows = [1, 2, 3, 4, 5].map((v, i) => row(`m${i}`, "sharpe", v));

    const map = scoreAgainstPopulation(rows, rows);

    expect(map.m2.sharpe).toBe(60);
    expect(map.m0.sharpe).toBe(20);
    expect(map.m4.sharpe).toBe(100);
  });

  it("a DISTINCT subject never shifts the scores of population members", () => {
    const rows = [1, 2, 3, 4, 5].map((v, i) => row(`m${i}`, "sharpe", v));
    const outsider = row("draft", "sharpe", 3);

    const selfOnly = scoreAgainstPopulation(rows, rows);
    const withOutsider = scoreAgainstPopulation([...rows, outsider], rows);

    for (const r of rows) {
      expect(withOutsider[r.id].sharpe).toBe(selfOnly[r.id].sharpe);
    }
    // …and the outsider still gets its own honest self-inclusive score:
    // effective = 6 values, count(<= 3) = 3 population + itself = 4 → 66.67 → 67.
    expect(withOutsider.draft.sharpe).toBe(67);
  });
});

describe("scoreAgainstPopulation — lower-is-better arms", () => {
  it("inverts volatility (positive lower-is-better)", () => {
    // population [0.1,0.2,0.3,0.4,0.5]; DISTINCT subject 0.1.
    // effective = 6 values; count(<= 0.1) = 2 (the 0.1 member + itself)
    // → raw 33.33 → inverted 66.67 → 67.
    const population = [0.1, 0.2, 0.3, 0.4, 0.5].map((v, i) => row(`p${i}`, "volatility", v));
    const subject = row("draft", "volatility", 0.1);

    const map = scoreAgainstPopulation([subject], population);

    expect(map.draft.volatility).toBe(67);
  });

  it("ranks max_drawdown by MAGNITUDE, then inverts", () => {
    // max_drawdown is stored NEGATIVE (quantstats convention). Without Math.abs
    // the inversion ranks the WORST drawdown best, because -0.50 < -0.05.
    // population magnitudes [0.50,0.25,0.10,0.05,0.01]; DISTINCT subject 0.05.
    // effective = 6 values; count(<= 0.05) = {0.05, 0.01, itself} = 3
    // → raw 50 → inverted 50.
    const population = [-0.5, -0.25, -0.1, -0.05, -0.01].map((v, i) =>
      row(`p${i}`, "max_drawdown", v),
    );
    const subject = row("draft", "max_drawdown", -0.05);

    const map = scoreAgainstPopulation([subject], population);

    expect(map.draft.max_drawdown).toBe(50);
  });
});

describe("scoreAgainstPopulation — map shape (W-D)", () => {
  it("mixes higher- and lower-is-better in ONE record and omits null metrics", () => {
    const population: Row[] = [
      { id: "p0", analytics: { cagr: 1, volatility: 0.1, max_drawdown: -0.5, sharpe: 1 } },
      { id: "p1", analytics: { cagr: 2, volatility: 0.2, max_drawdown: -0.25, sharpe: 2 } },
      { id: "p2", analytics: { cagr: 3, volatility: 0.3, max_drawdown: -0.1, sharpe: 3 } },
      { id: "p3", analytics: { cagr: 4, volatility: 0.4, max_drawdown: -0.05, sharpe: 4 } },
      { id: "p4", analytics: { cagr: 5, volatility: 0.5, max_drawdown: -0.01, sharpe: 5 } },
    ];
    const subject: Row = {
      id: "draft",
      analytics: { cagr: 3, volatility: 0.1, max_drawdown: -0.05, sharpe: null },
    };

    const map = scoreAgainstPopulation([subject], population);

    // cagr (higher better): effective 6, count(<=3) = {1,2,3,itself} = 4
    //   → 66.67 → 67.
    // volatility / max_drawdown as computed in the arms above.
    // sharpe is null on the subject → the KEY must be absent, not 0.
    // toEqual (not toMatchObject) pins the SHAPE: no extra keys leak in.
    expect(map.draft).toEqual({ cagr: 67, volatility: 67, max_drawdown: 50 });
    // Only subjects appear in the map — population rows are not scored.
    expect(Object.keys(map)).toEqual(["draft"]);
  });

  it("drops a subject entirely when every metric is null", () => {
    const population = [1, 2, 3, 4, 5].map((v, i) => row(`p${i}`, "sharpe", v));
    const blank = row("blank", "sharpe", null);

    const map = scoreAgainstPopulation([blank], population);

    expect(map.blank).toBeUndefined();
    expect(Object.keys(map)).toEqual([]);
  });

  it("skips a metric with no population values and no subject value", () => {
    // `sortino` is null everywhere → the key must not appear at all.
    const population = [1, 2, 3, 4, 5].map((v, i) => row(`p${i}`, "sharpe", v));
    const subject = row("draft", "sharpe", 3);

    const map = scoreAgainstPopulation([subject], population);

    expect(map.draft.sortino).toBeUndefined();
  });
});
