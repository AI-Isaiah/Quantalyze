import { describe, it, expect } from "vitest";
import {
  exposureWhy,
  keepExposurePoints,
  keepTurnoverPoints,
  turnoverWhy,
} from "./panel7-series";

/**
 * Phase 170.5 plan 05 Task 1 (D-03, D-04) — the pure guards and say-why
 * ladders behind the Net & gross exposure and Turnover sub-sections.
 *
 * Every sentence below is the UI-SPEC copy, verbatim (apostrophes are U+2019).
 * A test that restated the sentences loosely would pass a reworded ladder, so
 * they are pinned whole.
 */

const EXPOSURE_FEW =
  "Net and gross exposure isn’t available for this strategy: the stored series has fewer than 2 valid points.";
const EXPOSURE_CSV =
  "Net and gross exposure isn’t available for this strategy: it was uploaded as a CSV file, and no position-level series is stored for it.";
const EXPOSURE_ABSENT =
  "Net and gross exposure isn’t available for this strategy: no position-snapshot exposure series is stored for it.";
const TURNOVER_LEGACY =
  "Turnover isn’t available for this strategy: the stored turnover figures are not on a percent-of-NAV scale, so they are not shown.";
const TURNOVER_FEW =
  "Turnover isn’t available for this strategy: the stored series has fewer than 2 valid points.";
const TURNOVER_CSV =
  "Turnover isn’t available for this strategy: it was uploaded as a CSV file, and no position-level series is stored for it.";
const TURNOVER_ABSENT =
  "Turnover isn’t available for this strategy: no turnover series is computed for it.";

const LEGACY_ROW = { date: "2026-05-27", turnover: 4210.44 };

describe("keepExposurePoints (D-03 per-point guard, T-170.5-14)", () => {
  it("keeps only objects with a string date and finite gross and net", () => {
    const kept = keepExposurePoints([
      { date: "2026-05-27", gross: 53505.06, net: 53505.06 },
      { date: "2026-06-01", gross: 18164.46, net: -48544.8 },
      { date: 7, gross: 1, net: 1 },
      { date: "2026-06-02", gross: Number.NaN, net: 1 },
      { date: "2026-06-03", gross: 1, net: Number.POSITIVE_INFINITY },
      { date: "2026-06-04", gross: "1", net: 1 },
      null,
      "x",
    ]);
    expect(kept).toEqual([
      { date: "2026-05-27", gross: 53505.06, net: 53505.06 },
      { date: "2026-06-01", gross: 18164.46, net: -48544.8 },
    ]);
  });

  it("returns [] for a non-array (the lazy payload is untrusted JSONB)", () => {
    expect(keepExposurePoints(undefined)).toEqual([]);
    expect(keepExposurePoints(null)).toEqual([]);
    expect(keepExposurePoints("x")).toEqual([]);
    expect(keepExposurePoints({})).toEqual([]);
  });
});

describe("exposureWhy (D-03 ladder: data shape, then source, then absent)", () => {
  it("entries but fewer than 2 valid -> the fewer-than-2 sentence, even for a CSV upload", () => {
    expect(
      exposureWhy({
        exposure: [{ date: "2026-05-27", gross: 1, net: 1 }],
        turnover: [],
        flags: { csv_source: true },
      }),
    ).toBe(EXPOSURE_FEW);
  });

  it("exposure and turnover both empty and csv_source -> the CSV sentence", () => {
    expect(
      exposureWhy({ exposure: [], turnover: [], flags: { csv_source: true } }),
    ).toBe(EXPOSURE_CSV);
  });

  it("a stored turnover series means a position-level series exists -> not the CSV sentence", () => {
    expect(
      exposureWhy({
        exposure: [],
        turnover: [LEGACY_ROW],
        flags: { csv_source: true },
      }),
    ).toBe(EXPOSURE_ABSENT);
  });

  it("absent everything and no flags -> the no-snapshot-series sentence", () => {
    expect(
      exposureWhy({ exposure: undefined, turnover: undefined, flags: null }),
    ).toBe(EXPOSURE_ABSENT);
  });
});

describe("keepTurnoverPoints (D-04 contract gate, T-170.5-13)", () => {
  it("keeps {date: string, value: finite} entries", () => {
    expect(
      keepTurnoverPoints([
        { date: "a", value: 0.2 },
        { date: "b", value: 0.1 },
      ]),
    ).toEqual([
      { date: "a", value: 0.2 },
      { date: "b", value: 0.1 },
    ]);
  });

  it("drops a NaN value, a numeric date, a null entry and a {date, turnover} row", () => {
    expect(
      keepTurnoverPoints([
        { date: "a", value: Number.NaN },
        { date: 3, value: 0.1 },
        null,
        LEGACY_ROW,
      ]),
    ).toEqual([]);
  });

  it("returns [] for a non-array", () => {
    expect(keepTurnoverPoints("x")).toEqual([]);
    expect(keepTurnoverPoints({})).toEqual([]);
    expect(keepTurnoverPoints(null)).toEqual([]);
    expect(keepTurnoverPoints(undefined)).toEqual([]);
  });

  it("2 valid plus 1 bad -> the 2 valid points (the gate counts valid points)", () => {
    expect(
      keepTurnoverPoints([
        { date: "a", value: 0.2 },
        { date: "b", value: 0.1 },
        { date: 3, value: "x" },
      ]),
    ).toEqual([
      { date: "a", value: 0.2 },
      { date: "b", value: 0.1 },
    ]);
  });

  it("legacy rows beside valid rows are never charted and never converted", () => {
    const kept = keepTurnoverPoints([
      LEGACY_ROW,
      { date: "a", value: 0.2 },
      { date: "b", value: 0.1 },
    ]);
    expect(kept).toEqual([
      { date: "a", value: 0.2 },
      { date: "b", value: 0.1 },
    ]);
    expect(JSON.stringify(kept)).not.toContain("4210.44");
  });
});

describe("turnoverWhy (D-04 ladder: legacy, few, CSV, absent)", () => {
  it("legacy rows alone, whatever the source -> the scale sentence (rung 1 beats the CSV rung)", () => {
    expect(
      turnoverWhy({
        turnover: [LEGACY_ROW],
        exposure: [],
        flags: { csv_source: true },
      }),
    ).toBe(TURNOVER_LEGACY);
  });

  it("one legacy row plus one valid row -> still rung 1 (fewer than 2 kept)", () => {
    expect(
      turnoverWhy({
        turnover: [LEGACY_ROW, { date: "2026-05-28", value: 0.2 }],
        exposure: [],
        flags: null,
      }),
    ).toBe(TURNOVER_LEGACY);
  });

  it("one {date, value} point -> the fewer-than-2 sentence", () => {
    expect(
      turnoverWhy({
        turnover: [{ date: "2026-05-27", value: 0.2 }],
        exposure: [],
        flags: { csv_source: true },
      }),
    ).toBe(TURNOVER_FEW);
  });

  it("a malformed non-legacy array -> the fewer-than-2 sentence", () => {
    expect(
      turnoverWhy({
        turnover: [{ date: 1, value: "x" }, null],
        exposure: undefined,
        flags: null,
      }),
    ).toBe(TURNOVER_FEW);
  });

  it("both series empty and csv_source -> the CSV sentence", () => {
    expect(
      turnoverWhy({ turnover: [], exposure: [], flags: { csv_source: true } }),
    ).toBe(TURNOVER_CSV);
  });

  it("csv_source but exposure points exist -> the no-turnover-series sentence", () => {
    expect(
      turnoverWhy({
        turnover: [],
        exposure: [{ date: "2026-05-27", gross: 1, net: 1 }],
        flags: { csv_source: true },
      }),
    ).toBe(TURNOVER_ABSENT);
  });

  it("a non-array turnover (string or object) with exposure absent is treated as absent", () => {
    expect(
      turnoverWhy({ turnover: "x", exposure: undefined, flags: null }),
    ).toBe(TURNOVER_ABSENT);
    expect(
      turnoverWhy({ turnover: {}, exposure: undefined, flags: null }),
    ).toBe(TURNOVER_ABSENT);
    expect(
      turnoverWhy({
        turnover: "x",
        exposure: undefined,
        flags: { csv_source: true },
      }),
    ).toBe(TURNOVER_CSV);
  });
});

describe("copy", () => {
  it("all seven sentences use U+2019 in isn’t, never an ASCII apostrophe", () => {
    const all = [
      exposureWhy({
        exposure: [{ date: "d", gross: 1, net: 1 }],
        turnover: [],
        flags: null,
      }),
      exposureWhy({ exposure: [], turnover: [], flags: { csv_source: true } }),
      exposureWhy({ exposure: [], turnover: [], flags: null }),
      turnoverWhy({ turnover: [LEGACY_ROW], exposure: [], flags: null }),
      turnoverWhy({
        turnover: [{ date: "d", value: 1 }],
        exposure: [],
        flags: null,
      }),
      turnoverWhy({ turnover: [], exposure: [], flags: { csv_source: true } }),
      turnoverWhy({ turnover: [], exposure: [], flags: null }),
    ];
    expect(new Set(all).size).toBe(7);
    for (const s of all) {
      expect(s).toContain("isn’t available for this strategy");
      expect(s).not.toContain("isn't");
    }
  });
});
