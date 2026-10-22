import { describe, expect, it } from "vitest";
import { parseSnapshotRebuildBoundary } from "./snapshot-rebuild-boundary";

// Typed-literal oracles throughout: the expected value is written out, never
// derived from the parser (Phase 167.2.1.1.2 plan 02, D-03, AR-3).

describe("parseSnapshotRebuildBoundary", () => {
  it("a valid payload yields only boundaryDate", () => {
    const out = parseSnapshotRebuildBoundary({ boundary_date: "2026-07-24", extra: 1 });
    expect(out).toEqual({ boundaryDate: "2026-07-24" });
    expect(Object.keys(out!)).toEqual(["boundaryDate"]);
  });
});
