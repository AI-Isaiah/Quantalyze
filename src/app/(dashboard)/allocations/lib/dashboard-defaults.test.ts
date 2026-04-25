import { describe, it, expect } from "vitest";
import { LAYOUT_VERSION, DEFAULT_LAYOUT } from "./dashboard-defaults";
import { resolveWidgetId } from "./widget-registry";
import { WIDGET_COMPONENTS } from "../widgets";

// ---------------------------------------------------------------------------
// PR1 QA (dashboard parity) — v7 default layout invariants
// ---------------------------------------------------------------------------
//
// These assertions pin the shape that WidgetGrid + the V2 hook's
// reset-on-mismatch path consume. If a future phase touches DEFAULT_LAYOUT
// or LAYOUT_VERSION, this file fails first — preventing accidental drift
// (e.g. a 6th "outcomes" entry, a width outside 1..4, or a missing key).
//
// v7 (this file) adds the QA bump: short-key "allocation" now resolves to
// "allocation-by-style" instead of "allocation-donut", so persisted v6
// configs need a one-time reset to surface the new widget.

describe("dashboard-defaults v7 invariants", () => {
  it("LAYOUT_VERSION is 7 (PR1 QA — flip allocation short key to allocation-by-style)", () => {
    expect(LAYOUT_VERSION).toBe(7);
  });

  it("DEFAULT_LAYOUT has exactly 7 entries (PR1 — bridge/kpi/equity/holdings/allocation/mandate/outcomes)", () => {
    expect(DEFAULT_LAYOUT.length).toBe(7);
  });

  it("every tile has a string `k` and a `w` in {1,2,3,4}", () => {
    for (const tile of DEFAULT_LAYOUT) {
      expect(typeof tile.k).toBe("string");
      expect(tile.k.length).toBeGreaterThan(0);
      expect([1, 2, 3, 4]).toContain(tile.w);
    }
  });

  it("the 7 keys are bridge/kpi/equity/holdings/allocation/mandate/outcomes in that order", () => {
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

  it("widths match prototype Allocator-Dashboard-Standalone.html (bridge,kpi,equity,holdings,allocation,mandate,outcomes)=(4,4,4,3,1,2,2)", () => {
    expect(DEFAULT_LAYOUT.map((t) => t.w)).toEqual([4, 4, 4, 3, 1, 2, 2]);
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
