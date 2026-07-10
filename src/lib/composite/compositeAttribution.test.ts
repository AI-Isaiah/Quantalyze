import { describe, it, expect } from "vitest";
import {
  partitionAttribution,
  attributionBasisFromConfig,
} from "./compositeAttribution";

// Business context (Phase 89 PREV-01): the composite preview partitions the
// ALREADY-STITCHED `csv_daily_returns` series by each member key's inclusive
// `data_quality_flags.per_key.{first_day,last_day}` window. It NEVER re-stitches
// on the client (a fork would risk the v1.5 silent-divergence). These pins
// falsify a half-open drift of the inclusive slice, a basis mix-up against the
// server's `cumulative_method` branch, and any zero-fill of no-data members.

describe("partitionAttribution", () => {
  it("Σ member days == Σ present days across a 3-member fixture with interior gaps", () => {
    // Falsifies a half-open drift (Pitfall 2): the per_key window is
    // INCLUSIVE-both-ends, distinct from the half-open declared strategy_keys
    // window. Flipping the last_day compare from `<=` to `<` would drop the
    // 09-03 / 09-08 / 09-12 boundary days and break this sum. Gap days
    // (09-07, 09-09) are ABSENT from the series — never zero-filled.
    const series = [
      { date: "2025-09-01", daily_return: 0.01 },
      { date: "2025-09-02", daily_return: 0.02 },
      { date: "2025-09-03", daily_return: 0.03 }, // A boundary (last_day)
      { date: "2025-09-06", daily_return: 0.01 },
      { date: "2025-09-08", daily_return: 0.02 }, // B boundary; 09-07 is a gap (absent)
      { date: "2025-09-10", daily_return: 0.01 },
      { date: "2025-09-11", daily_return: 0.02 },
      { date: "2025-09-12", daily_return: 0.03 }, // C boundary; 09-09 is a gap (absent)
    ];
    const perKey = [
      { seq: 1, first_day: "2025-09-01", last_day: "2025-09-03" },
      { seq: 2, first_day: "2025-09-06", last_day: "2025-09-08" },
      { seq: 3, first_day: "2025-09-10", last_day: "2025-09-12" },
    ];

    const out = partitionAttribution(series, perKey, "arithmetic");
    const totalDays = out.reduce((sum, m) => sum + m.days, 0);

    expect(totalDays).toBe(series.length);
    expect(out.map((m) => m.days)).toEqual([3, 2, 3]);
  });

  it("assigns a handoff day to exactly one member under the inclusive convention", () => {
    // A ends 09-24, B starts 09-27; the present day 09-27 belongs ONLY to B
    // and 09-24 ONLY to A. A boundary day must never double-count across the
    // handoff (members are disjoint by the worker's assert_windows_disjoint).
    // perKey is passed OUT of seq order to pin the ascending-seq output order.
    const series = [
      { date: "2025-09-24", daily_return: 0.05 },
      { date: "2025-09-27", daily_return: 0.07 },
    ];
    const perKey = [
      { seq: 2, first_day: "2025-09-27", last_day: "2025-09-30" },
      { seq: 1, first_day: "2025-09-20", last_day: "2025-09-24" },
    ];

    const out = partitionAttribution(series, perKey, "arithmetic");

    expect(out.map((m) => m.seq)).toEqual([1, 2]); // ascending seq, not input order
    expect(out[0].days).toBe(1); // A owns only 09-24
    expect(out[1].days).toBe(1); // B owns only 09-27
    expect(out[0].contribution).toBeCloseTo(0.05, 12);
    expect(out[1].contribution).toBeCloseTo(0.07, 12);
  });

  it("carries no member for gap days (absent from csv_daily_returns), totals still reconcile", () => {
    // 09-04 and 09-05 are gap days — absent from the series entirely. No bucket
    // may exceed its window's PRESENT days; the sum still equals series.length.
    // Absence is never fabricated into a 0 return (no-invented-data).
    const series = [
      { date: "2025-09-01", daily_return: 0.01 },
      { date: "2025-09-03", daily_return: 0.02 }, // 09-02 gap (absent)
      { date: "2025-09-06", daily_return: 0.03 }, // 09-04, 09-05 gap (absent)
    ];
    const perKey = [
      { seq: 1, first_day: "2025-09-01", last_day: "2025-09-03" },
      { seq: 2, first_day: "2025-09-06", last_day: "2025-09-08" },
    ];

    const out = partitionAttribution(series, perKey, "arithmetic");

    expect(out[0].days).toBe(2); // 09-01, 09-03 present; 09-02 absent
    expect(out[1].days).toBe(1); // only 09-06 present
    expect(out.reduce((s, m) => s + m.days, 0)).toBe(series.length);
  });

  it("arithmetic basis: each contribution is Σ daily_return; Σ contributions reconstitutes the headline", () => {
    // COMP-03: on the cumulative_method='simple' (allocated/Zavara) path the
    // additive partition Σr must sum back to the composite headline exactly.
    const series = [
      { date: "2025-09-01", daily_return: 0.1 },
      { date: "2025-09-02", daily_return: -0.1 },
      { date: "2025-09-05", daily_return: 0.1 },
      { date: "2025-09-06", daily_return: 0.1 },
    ];
    const perKey = [
      { seq: 1, first_day: "2025-09-01", last_day: "2025-09-02" },
      { seq: 2, first_day: "2025-09-05", last_day: "2025-09-06" },
    ];

    const out = partitionAttribution(series, perKey, "arithmetic");

    expect(out[0].contribution).toBeCloseTo(0.0, 12); // 0.1 + (-0.1)
    expect(out[1].contribution).toBeCloseTo(0.2, 12); // 0.1 + 0.1
    const headline = series.reduce((s, r) => s + r.daily_return, 0);
    const summed = out.reduce((s, m) => s + (m.contribution ?? 0), 0);
    expect(summed).toBeCloseTo(headline, 12);
  });

  it("geometric basis: each contribution is Π(1+r)−1; disjoint windows factorize the composite product", () => {
    // Default (cumulative_method absent/'geometric') path. Returns are ±0.10 so
    // the geometric answer DIFFERS materially from the arithmetic one — this
    // falsifies a basis mix-up in either direction. Disjoint member windows
    // factorize the total product exactly: Π(1+cᵢ)−1 == Π(1+r)−1 over all days.
    const series = [
      { date: "2025-09-01", daily_return: 0.1 },
      { date: "2025-09-02", daily_return: -0.1 },
      { date: "2025-09-05", daily_return: 0.1 },
      { date: "2025-09-06", daily_return: 0.1 },
    ];
    const perKey = [
      { seq: 1, first_day: "2025-09-01", last_day: "2025-09-02" },
      { seq: 2, first_day: "2025-09-05", last_day: "2025-09-06" },
    ];

    const out = partitionAttribution(series, perKey, "geometric");

    expect(out[0].contribution).toBeCloseTo(1.1 * 0.9 - 1, 12); // -0.01
    expect(out[1].contribution).toBeCloseTo(1.1 * 1.1 - 1, 12); // 0.21
    // Materially different from the arithmetic buckets (0 and 0.2).
    expect(out[0].contribution).not.toBeCloseTo(0.0, 3);

    const totalProduct =
      series.reduce((p, r) => p * (1 + r.daily_return), 1) - 1;
    const factorized =
      out.reduce((p, m) => p * (1 + (m.contribution ?? 0)), 1) - 1;
    expect(factorized).toBeCloseTo(totalProduct, 12);
  });

  it("a member with no data days gets contribution null, never a fabricated 0", () => {
    // A no-data member (per_key first_day/last_day null, n_days 0) contributed
    // no returns; its contribution is null. A 0 would be an INVENTED return that
    // falsely reads as flat performance (no-invented-data).
    const series = [{ date: "2025-09-01", daily_return: 0.05 }];
    const perKey = [
      { seq: 1, first_day: "2025-09-01", last_day: "2025-09-01" },
      { seq: 2, first_day: null, last_day: null },
    ];

    const out = partitionAttribution(series, perKey, "arithmetic");

    expect(out[1]).toEqual({ seq: 2, days: 0, contribution: null });
    expect(out[1].contribution).not.toBe(0);
  });

  it("empty series → every member is {days:0, contribution:null}; empty perKey → []", () => {
    const perKey = [
      { seq: 1, first_day: "2025-09-01", last_day: "2025-09-03" },
      { seq: 2, first_day: "2025-09-06", last_day: "2025-09-08" },
    ];

    expect(partitionAttribution([], perKey, "arithmetic")).toEqual([
      { seq: 1, days: 0, contribution: null },
      { seq: 2, days: 0, contribution: null },
    ]);
    expect(
      partitionAttribution(
        [{ date: "2025-09-01", daily_return: 0.05 }],
        [],
        "arithmetic",
      ),
    ).toEqual([]);
  });
});

describe("attributionBasisFromConfig", () => {
  // Mirrors analytics-service/services/job_worker.py:3250-3255 +
  // allocated_capital.py:241-247 VERBATIM: `cumulative_method` is an OPTIONAL
  // key on the `returns_denominator_config` jsonb. The ONLY arithmetic trigger
  // is the literal "simple" on a non-null object config; ABSENT config, an
  // absent key, "geometric", junk, or a non-object all default to geometric.
  it("returns arithmetic only for a non-null object with cumulative_method === 'simple'", () => {
    expect(attributionBasisFromConfig({ cumulative_method: "simple" })).toBe(
      "arithmetic",
    );
  });

  it("defaults to geometric for null / undefined / absent config", () => {
    expect(attributionBasisFromConfig(null)).toBe("geometric");
    expect(attributionBasisFromConfig(undefined)).toBe("geometric");
  });

  it("defaults to geometric for an object with no cumulative_method key", () => {
    expect(attributionBasisFromConfig({})).toBe("geometric");
  });

  it("returns geometric for an explicit cumulative_method === 'geometric'", () => {
    expect(attributionBasisFromConfig({ cumulative_method: "geometric" })).toBe(
      "geometric",
    );
  });

  it("returns geometric for junk cumulative_method values", () => {
    expect(attributionBasisFromConfig({ cumulative_method: "junk" })).toBe(
      "geometric",
    );
    expect(attributionBasisFromConfig({ cumulative_method: 42 })).toBe(
      "geometric",
    );
  });

  it("returns geometric for a non-object (e.g. the bare string 'simple')", () => {
    // A bare "simple" string is NOT an object config — the server reads the key
    // off a jsonb object, so a scalar can never select arithmetic.
    expect(attributionBasisFromConfig("simple")).toBe("geometric");
    expect(attributionBasisFromConfig(0)).toBe("geometric");
    expect(attributionBasisFromConfig(true)).toBe("geometric");
  });
});
