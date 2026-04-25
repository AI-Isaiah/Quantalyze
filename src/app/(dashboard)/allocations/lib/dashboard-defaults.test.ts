import { describe, it, expect } from "vitest";
import { LAYOUT_VERSION, DEFAULT_LAYOUT } from "./dashboard-defaults";
import { resolveWidgetId } from "./widget-registry";
import { WIDGET_COMPONENTS } from "../widgets";

// ---------------------------------------------------------------------------
// Phase 09.1 D-02 + D-06 — v5 default layout invariants
// ---------------------------------------------------------------------------
//
// These assertions pin the shape that Plan 05's WidgetGrid + the V2 hook's
// reset-on-mismatch path consume. If a future phase touches DEFAULT_LAYOUT
// or LAYOUT_VERSION, this file fails first — preventing accidental drift
// (e.g. a 5th "outcomes" entry, a width outside 1..4, or a missing key).

describe("dashboard-defaults v5 invariants", () => {
  it("LAYOUT_VERSION is 5 (v0.15.7.0 follow-up — drop unmapped 'mandate' tile)", () => {
    expect(LAYOUT_VERSION).toBe(5);
  });

  it("DEFAULT_LAYOUT has exactly 6 entries (D-06 minus 'mandate')", () => {
    expect(DEFAULT_LAYOUT.length).toBe(6);
  });

  it("every tile has a string `k` and a `w` in {1,2,3,4}", () => {
    for (const tile of DEFAULT_LAYOUT) {
      expect(typeof tile.k).toBe("string");
      expect(tile.k.length).toBeGreaterThan(0);
      expect([1, 2, 3, 4]).toContain(tile.w);
    }
  });

  it("the 6 keys are bridge/kpi/equity/holdings/allocation/outcomes in that order", () => {
    expect(DEFAULT_LAYOUT.map((t) => t.k)).toEqual([
      "bridge",
      "kpi",
      "equity",
      "holdings",
      "allocation",
      "outcomes",
    ]);
  });

  it("widths match designer-bundle/app.jsx (bridge,kpi,equity,holdings,allocation,outcomes)=(4,4,4,3,1,4)", () => {
    expect(DEFAULT_LAYOUT.map((t) => t.w)).toEqual([4, 4, 4, 3, 1, 4]);
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

  // Regression: prior to v0.15.7.0 follow-up, several DEFAULT_LAYOUT short
  // keys ("kpi", "holdings", "mandate") resolved to placeholder ids that had
  // no entry in WIDGET_COMPONENTS, so the V2 Overview tab rendered three
  // "Unknown widget: <id>" debug placeholders for every newly-logged-in user.
  // This guard catches the same class of regression: every short key in
  // DEFAULT_LAYOUT must resolve (via resolveWidgetId) to an id that has a
  // real component in WIDGET_COMPONENTS.
  it("every short key resolves to a registered widget component (no 'Unknown widget' fallbacks on default Overview)", () => {
    for (const tile of DEFAULT_LAYOUT) {
      const resolved = resolveWidgetId(tile.k);
      expect(
        WIDGET_COMPONENTS[resolved],
        `tile.k=${tile.k} resolves to '${resolved}' which has no WIDGET_COMPONENTS entry — would render as "Unknown widget" on Overview`,
      ).toBeDefined();
    }
  });
});
