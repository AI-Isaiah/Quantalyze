import { describe, it, expect } from "vitest";
import { NEVER_COMPUTED_STAMP, isNeverComputedStamp } from "./never-computed-stamp";

describe("isNeverComputedStamp", () => {
  it("is true for every spelling of 'no compute date'", () => {
    expect(isNeverComputedStamp(null)).toBe(true);
    expect(isNeverComputedStamp(undefined)).toBe(true);
    expect(isNeverComputedStamp("")).toBe(true);
    expect(isNeverComputedStamp(NEVER_COMPUTED_STAMP)).toBe(true);
    expect(isNeverComputedStamp("1970-01-01T00:00:00Z")).toBe(true);
  });

  it("is true for the +00:00 spelling PostgREST returns for the rollback's epoch fill", () => {
    expect(isNeverComputedStamp("1970-01-01T00:00:00+00:00")).toBe(true);
    expect(isNeverComputedStamp("1970-01-01T00:00:00.000Z")).toBe(true);
  });

  it("is false for a real compute date, so a computed row keeps its date", () => {
    expect(isNeverComputedStamp("2026-05-12T00:00:00Z")).toBe(false);
    expect(isNeverComputedStamp("2026-11-26T08:00:00.000Z")).toBe(false);
  });
});
