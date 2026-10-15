import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseReconstructedRanges,
  parseUnrecoveredGaps,
  readReconstructedRanges,
} from "./trade-fetch-provenance";

// Typed-literal oracles throughout: the expected spans are written out, never
// derived from the parser, so a parser that drops or reorders fields fails.

describe("parseUnrecoveredGaps", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty object", {}],
    ["empty gap list", { unrecovered_gaps: [] }],
    ["legacy_ranges only (storage provenance, not UI)", {
      legacy_ranges: [{ from: "2026-01-01", to: "2026-02-01" }],
    }],
  ])("%s yields [] with no warning", (_name, input) => {
    expect(parseUnrecoveredGaps(input)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps only {from,to}, dropping recorded_at and any other key", () => {
    const out = parseUnrecoveredGaps({
      unrecovered_gaps: [
        { from: "2026-05-07", to: "2026-07-08", recorded_at: "2026-10-10T00:00:00Z" },
      ],
    });
    expect(out).toEqual([{ from: "2026-05-07", to: "2026-07-08" }]);
    expect(Object.keys(out[0]).sort()).toEqual(["from", "to"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts a one-day gap (from equals to)", () => {
    expect(
      parseUnrecoveredGaps({ unrecovered_gaps: [{ from: "2026-07-08", to: "2026-07-08" }] }),
    ).toEqual([{ from: "2026-07-08", to: "2026-07-08" }]);
  });

  it("sorts newest `to` first", () => {
    const out = parseUnrecoveredGaps({
      unrecovered_gaps: [
        { from: "2026-01-02", to: "2026-01-05" },
        { from: "2026-08-01", to: "2026-08-03" },
        { from: "2026-04-10", to: "2026-04-12" },
      ],
    });
    expect(out).toEqual([
      { from: "2026-08-01", to: "2026-08-03" },
      { from: "2026-04-10", to: "2026-04-12" },
      { from: "2026-01-02", to: "2026-01-05" },
    ]);
  });

  it.each([
    ["to before from", { unrecovered_gaps: [{ from: "2026-07-08", to: "2026-05-07" }] }],
    ["non-ISO date", { unrecovered_gaps: [{ from: "07/08/2026", to: "2026-07-09" }] }],
    ["timestamp instead of date", { unrecovered_gaps: [{ from: "2026-07-08T00:00:00Z", to: "2026-07-09" }] }],
    ["calendar-impossible date", { unrecovered_gaps: [{ from: "2026-02-30", to: "2026-03-02" }] }],
    ["missing field", { unrecovered_gaps: [{ from: "2026-07-08" }] }],
    ["non-string date", { unrecovered_gaps: [{ from: 20260708, to: 20260709 }] }],
    ["non-array unrecovered_gaps", { unrecovered_gaps: "2026-07-08" }],
    ["object unrecovered_gaps", { unrecovered_gaps: { from: "2026-07-08", to: "2026-07-09" } }],
    ["non-object entry", { unrecovered_gaps: ["2026-07-08"] }],
    ["null entry", { unrecovered_gaps: [null] }],
    ["non-object provenance (string)", "unrecovered_gaps"],
    ["non-object provenance (number)", 7],
    ["array provenance", [{ from: "2026-07-08", to: "2026-07-09" }]],
  ])("malformed (%s) yields [] and warns once", (_name, input) => {
    expect(parseUnrecoveredGaps(input)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("one malformed entry voids the whole record: no half-claim renders", () => {
    const out = parseUnrecoveredGaps({
      unrecovered_gaps: [
        { from: "2026-05-07", to: "2026-07-08" },
        { from: "2026-09-09", to: "2026-09-01" },
      ],
    });
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never throws on hostile input", () => {
    const hostile = { get unrecovered_gaps(): unknown { throw new Error("boom"); } };
    expect(() => parseUnrecoveredGaps(hostile)).not.toThrow();
    expect(parseUnrecoveredGaps(hostile)).toEqual([]);
  });
});

// Phase 167.1.2.2.2.1 (OKXHISTORY), D-05/D-06: the gate between stored
// provenance and a public "rebuilt from the venue archive" claim. Literal
// oracles, same discipline as above.
describe("parseReconstructedRanges", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const SRC = "okx_bills_history_archive";

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty object (key absent)", {}],
    ["empty list", { reconstructed_ranges: [] }],
    ["null key", { reconstructed_ranges: null }],
    ["unrecovered_gaps only (the sibling key, not this record)", {
      unrecovered_gaps: [{ from: "2026-05-24", to: "2026-06-30" }],
    }],
  ])("%s yields [] with no warning", (_name, input) => {
    expect(parseReconstructedRanges(input)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps only {from,to,source}, dropping recorded_at and any other key", () => {
    const out = parseReconstructedRanges({
      reconstructed_ranges: [
        { from: "2026-07-01", to: "2026-08-01", source: SRC, recorded_at: "2026-10-20T10:00:00Z", extra: 1 },
      ],
    });
    expect(out).toEqual([{ from: "2026-07-01", to: "2026-08-01", source: SRC }]);
    expect(Object.keys(out[0]).sort()).toEqual(["from", "source", "to"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts a one-day range (from equals to)", () => {
    expect(
      parseReconstructedRanges({ reconstructed_ranges: [{ from: "2026-07-08", to: "2026-07-08", source: SRC }] }),
    ).toEqual([{ from: "2026-07-08", to: "2026-07-08", source: SRC }]);
  });

  it("three valid entries come back newest `to` first", () => {
    const out = parseReconstructedRanges({
      reconstructed_ranges: [
        { from: "2026-01-02", to: "2026-01-05", source: SRC },
        { from: "2026-08-01", to: "2026-08-03", source: SRC },
        { from: "2026-04-10", to: "2026-04-12", source: SRC },
      ],
    });
    expect(out).toEqual([
      { from: "2026-08-01", to: "2026-08-03", source: SRC },
      { from: "2026-04-10", to: "2026-04-12", source: SRC },
      { from: "2026-01-02", to: "2026-01-05", source: SRC },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["to before from", { reconstructed_ranges: [{ from: "2026-08-01", to: "2026-07-01", source: SRC }] }],
    ["calendar-impossible date", { reconstructed_ranges: [{ from: "2026-02-30", to: "2026-03-02", source: SRC }] }],
    ["non-ISO date", { reconstructed_ranges: [{ from: "07/01/2026", to: "2026-07-09", source: SRC }] }],
    ["timestamp instead of date", { reconstructed_ranges: [{ from: "2026-07-01T00:00:00Z", to: "2026-07-09", source: SRC }] }],
    ["missing to", { reconstructed_ranges: [{ from: "2026-07-01", source: SRC }] }],
    ["missing source", { reconstructed_ranges: [{ from: "2026-07-01", to: "2026-07-09" }] }],
    ["foreign source (manual)", { reconstructed_ranges: [{ from: "2026-07-01", to: "2026-07-09", source: "manual" }] }],
    ["non-string source", { reconstructed_ranges: [{ from: "2026-07-01", to: "2026-07-09", source: 1 }] }],
    ["non-array reconstructed_ranges", { reconstructed_ranges: "2026-07-01" }],
    ["object reconstructed_ranges", { reconstructed_ranges: { from: "2026-07-01", to: "2026-07-09", source: SRC } }],
    ["non-object entry", { reconstructed_ranges: ["2026-07-01"] }],
    ["null entry", { reconstructed_ranges: [null] }],
    ["non-object provenance (string)", "reconstructed_ranges"],
    ["array provenance", [{ from: "2026-07-01", to: "2026-07-09", source: SRC }]],
  ])("malformed (%s) yields [] and warns exactly once", (_name, input) => {
    expect(parseReconstructedRanges(input)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("one bad entry voids the whole record: no half-claim renders", () => {
    const out = parseReconstructedRanges({
      reconstructed_ranges: [
        { from: "2026-07-01", to: "2026-08-01", source: SRC },
        { from: "2026-09-01", to: "2026-09-05", source: "manual" },
      ],
    });
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never throws on hostile input", () => {
    const hostile = { get reconstructed_ranges(): unknown { throw new Error("boom"); } };
    expect(() => parseReconstructedRanges(hostile)).not.toThrow();
    expect(parseReconstructedRanges(hostile)).toEqual([]);
  });

  it("parseUnrecoveredGaps is untouched by a reconstructed_ranges key beside it", () => {
    const both = {
      unrecovered_gaps: [{ from: "2026-05-24", to: "2026-06-30" }],
      reconstructed_ranges: [{ from: "2026-07-01", to: "2026-08-01", source: "manual" }],
    };
    expect(parseUnrecoveredGaps(both)).toEqual([{ from: "2026-05-24", to: "2026-06-30" }]);
    expect(warn).not.toHaveBeenCalled();
  });
});

// Phase 167.1.2.2.2.1 review round 1, F5 / IN-01: a malformed record must be
// told apart from an absent one. `parseReconstructedRanges` returns [] for both,
// which let a public page present rebuilt days as live with no disclosure and
// no Sentry event. `readReconstructedRanges` carries the verdict the callers
// report and render.
describe("readReconstructedRanges", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const SRC = "okx_bills_history_archive";

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty object (key absent)", {}],
    ["empty list", { reconstructed_ranges: [] }],
    ["null key", { reconstructed_ranges: null }],
  ])("%s is absent, not malformed", (_name, input) => {
    expect(readReconstructedRanges(input)).toEqual({ ranges: [], malformed: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it("a valid record carries its ranges and no malformed reason", () => {
    expect(
      readReconstructedRanges({
        reconstructed_ranges: [{ from: "2026-07-01", to: "2026-08-01", source: SRC, recorded_at: "x" }],
      }),
    ).toEqual({
      ranges: [{ from: "2026-07-01", to: "2026-08-01", source: SRC }],
      malformed: null,
    });
  });

  it.each([
    ["non-object provenance", "reconstructed_ranges", "provenance is not an object"],
    ["non-array list", { reconstructed_ranges: "2026-07-01" }, "reconstructed_ranges is not an array"],
    ["non-object entry", { reconstructed_ranges: [null] }, "an entry is not an object"],
    [
      "calendar-impossible date",
      { reconstructed_ranges: [{ from: "2026-02-30", to: "2026-03-02", source: SRC }] },
      "an entry date is not a YYYY-MM-DD calendar date",
    ],
    [
      "to before from",
      { reconstructed_ranges: [{ from: "2026-08-01", to: "2026-07-01", source: SRC }] },
      "an entry ends before it starts",
    ],
    [
      "foreign source",
      { reconstructed_ranges: [{ from: "2026-07-01", to: "2026-07-09", source: "manual" }] },
      "an entry carries an unknown source",
    ],
  ])("%s is malformed with a named reason, ranges empty", (_name, input, reason) => {
    expect(readReconstructedRanges(input)).toEqual({ ranges: [], malformed: reason });
  });

  it("one bad entry voids the record but still reports it malformed (never a silent [])", () => {
    const out = readReconstructedRanges({
      reconstructed_ranges: [
        { from: "2026-07-01", to: "2026-08-01", source: SRC },
        { from: "2026-09-01", to: "2026-09-05", source: "manual" },
      ],
    });
    expect(out.ranges).toEqual([]);
    expect(out.malformed).toBe("an entry carries an unknown source");
  });

  it("a hostile provenance is malformed, not a throw", () => {
    const hostile = { get reconstructed_ranges(): unknown { throw new Error("boom"); } };
    expect(readReconstructedRanges(hostile)).toEqual({
      ranges: [],
      malformed: "provenance could not be read",
    });
  });
});
