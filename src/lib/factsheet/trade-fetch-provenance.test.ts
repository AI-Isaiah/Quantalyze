import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseUnrecoveredGaps } from "./trade-fetch-provenance";

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
