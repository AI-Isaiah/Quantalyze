import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSnapshotRebuildBoundary } from "./snapshot-rebuild-boundary";

// Typed-literal oracles throughout: the expected value is written out, never
// derived from the parser (Phase 167.2.1.1.2 plan 02, D-03, AR-3). The payload
// is worker/SQL-written JSONB and crosses into a typed field here, so a
// malformed one must name no boundary rather than render a bogus date.

describe("parseSnapshotRebuildBoundary", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("a valid payload yields only boundaryDate", () => {
    const out = parseSnapshotRebuildBoundary({ boundary_date: "2026-07-24", extra: 1 });
    expect(out).toEqual({ boundaryDate: "2026-07-24" });
    expect(Object.keys(out!)).toEqual(["boundaryDate"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("%s yields null with no warning (no row means nothing was rebuilt)", (_name, input) => {
    expect(parseSnapshotRebuildBoundary(input)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a string, not an object", "2026-07-24"],
    ["an empty array", []],
    ["an array holding the object", [{ boundary_date: "2026-07-24" }]],
    ["an object without the key", {}],
    ["a null boundary_date", { boundary_date: null }],
    ["a numeric boundary_date", { boundary_date: 20260724 }],
    ["an impossible calendar date (2026-02-30)", { boundary_date: "2026-02-30" }],
    ["an unpadded date", { boundary_date: "2026-1-5" }],
    ["a timestamp, not a date", { boundary_date: "2026-07-24T00:00:00Z" }],
    ["a date with leading whitespace", { boundary_date: " 2026-07-24" }],
  ])("%s yields null and one warning naming no input value", (_name, input) => {
    expect(parseSnapshotRebuildBoundary(input)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0][0]);
    expect(text).toContain("malformed");
    expect(text).not.toContain("2026");
    expect(text).not.toContain("20260724");
  });

  it("a getter that throws on boundary_date yields null with one warning", () => {
    const hostile = {
      get boundary_date(): string {
        throw new Error("boom");
      },
    };
    expect(parseSnapshotRebuildBoundary(hostile)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("malformed");
  });
});
