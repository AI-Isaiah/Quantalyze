import { describe, it, expect } from "vitest";
import { LAYOUT_VERSION, DEFAULT_LAYOUT } from "./dashboard-defaults";

// ---------------------------------------------------------------------------
// Phase 09.1 D-02 + D-06 — v4 default layout invariants
// ---------------------------------------------------------------------------
//
// These assertions pin the shape that Plan 05's WidgetGrid + the V2 hook's
// reset-on-mismatch path consume. If a future phase touches DEFAULT_LAYOUT
// or LAYOUT_VERSION, this file fails first — preventing accidental drift
// (e.g. a 5th "outcomes" entry, a width outside 1..4, or a missing key).

describe("dashboard-defaults v4 invariants", () => {
  it("LAYOUT_VERSION is 4 (Phase 09.1 D-02 bump from v3)", () => {
    expect(LAYOUT_VERSION).toBe(4);
  });

  it("DEFAULT_LAYOUT has exactly 7 entries (D-06 — designer's Overview default)", () => {
    expect(DEFAULT_LAYOUT.length).toBe(7);
  });

  it("every tile has a string `k` and a `w` in {1,2,3,4}", () => {
    for (const tile of DEFAULT_LAYOUT) {
      expect(typeof tile.k).toBe("string");
      expect(tile.k.length).toBeGreaterThan(0);
      expect([1, 2, 3, 4]).toContain(tile.w);
    }
  });

  it("the 7 keys are exactly bridge/kpi/equity/holdings/allocation/mandate/outcomes in that order", () => {
    expect(DEFAULT_LAYOUT.map((t) => t.k)).toEqual([
      "bridge",
      "kpi",
      "equity",
      "holdings",
      "allocation",
      "mandate",
      "outcomes",
    ]);
  });

  it("widths match designer-bundle/app.jsx:18-26 (4,4,4,3,1,2,4)", () => {
    expect(DEFAULT_LAYOUT.map((t) => t.w)).toEqual([4, 4, 4, 3, 1, 2, 4]);
  });

  it("no entry carries legacy fields (i / widgetId / x / y / h)", () => {
    for (const tile of DEFAULT_LAYOUT) {
      expect(tile).not.toHaveProperty("i");
      expect(tile).not.toHaveProperty("widgetId");
      expect(tile).not.toHaveProperty("x");
      expect(tile).not.toHaveProperty("y");
      expect(tile).not.toHaveProperty("h");
    }
  });
});
