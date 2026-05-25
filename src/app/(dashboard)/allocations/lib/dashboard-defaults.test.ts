import { describe, it, expect } from "vitest";
import { LAYOUT_VERSION, DEFAULT_LAYOUT } from "./dashboard-defaults";
import { resolveWidgetId, WIDGET_REGISTRY } from "./widget-registry";
import { WIDGET_COMPONENTS } from "../widgets";

// Default Overview layout invariants. Holdings is intentionally absent —
// it lives on the dedicated Holdings tab where the full-width detail
// table belongs. These assertions pin the shape that WidgetGrid + the V2
// hook's reset-on-mismatch path consume.

describe("dashboard-defaults default-layout invariants", () => {
  it("LAYOUT_VERSION is 9 (holdings removed from Overview default — lives on the Holdings tab)", () => {
    expect(LAYOUT_VERSION).toBe(9);
  });

  it("DEFAULT_LAYOUT has exactly 6 entries (kpi/bridge/equity/allocation/mandate/outcomes — no holdings)", () => {
    expect(DEFAULT_LAYOUT.length).toBe(6);
  });

  it("every tile has a string `k` and a `w` in {1,2,3,4}", () => {
    for (const tile of DEFAULT_LAYOUT) {
      expect(typeof tile.k).toBe("string");
      expect(tile.k.length).toBeGreaterThan(0);
      expect([1, 2, 3, 4]).toContain(tile.w);
    }
  });

  it("the 6 keys are kpi/bridge/equity/allocation/mandate/outcomes in that order", () => {
    expect(DEFAULT_LAYOUT.map((t) => t.k)).toEqual([
      "kpi",
      "bridge",
      "equity",
      "allocation",
      "mandate",
      "outcomes",
    ]);
  });

  it("widths (kpi,bridge,equity,allocation,mandate,outcomes)=(4,4,4,2,2,4)", () => {
    expect(DEFAULT_LAYOUT.map((t) => t.w)).toEqual([4, 4, 4, 2, 2, 4]);
  });

  it("does NOT include holdings (it lives on the Holdings tab)", () => {
    expect(DEFAULT_LAYOUT.map((t) => t.k)).not.toContain("holdings");
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

  // M-0144 (pr-test-analyzer) — the WIDGET_COMPONENTS guard above catches the
  // "Unknown widget" render fallback, but the V2 load path
  // (useDashboardConfig.ts:394 validateAndNormalizeTile) ALSO drops any tile
  // whose resolved id is not an OWN key of WIDGET_REGISTRY — silently, before
  // it ever reaches WIDGET_COMPONENTS. So a default key resolving to an id
  // present in WIDGET_COMPONENTS but ABSENT from WIDGET_REGISTRY would be
  // dropped at load and never render at all (worse: no fallback shown). Pin
  // that every DEFAULT_LAYOUT key resolves into WIDGET_REGISTRY too, using
  // the same hasOwnProperty gate the validator uses (so a prototype-chain
  // match cannot mask the drift).
  it("every short key resolves to an OWN WIDGET_REGISTRY entry (else the V2 load validator silently drops it)", () => {
    for (const tile of DEFAULT_LAYOUT) {
      const resolved = resolveWidgetId(tile.k);
      expect(
        Object.prototype.hasOwnProperty.call(WIDGET_REGISTRY, resolved),
        `tile.k=${tile.k} resolves to '${resolved}' which is not an OWN WIDGET_REGISTRY key — validateAndNormalizeTile would drop it on load, so it never renders on a fresh Overview`,
      ).toBe(true);
    }
  });

  // M-0141 (pr-test-analyzer) — the codebase contract for a LAYOUT_VERSION
  // bump is FORCE-RESET (Voice-D8 reset-on-mismatch), NOT a preserve-customizations
  // migration. There is intentionally no per-version migration table. The
  // runtime reset behavior is pinned in useDashboardConfig.test.ts
  // (version_reset for v3 / v9999 / negative / zero). This source-level guard
  // documents that DEFAULT_LAYOUT carries no migration metadata that a
  // contributor might mistake for a preserve path — every entry is a plain
  // {k, w} tile with no version-conditional fields.
  it("DEFAULT_LAYOUT carries no migration/version metadata (bump = force-reset, never preserve)", () => {
    for (const tile of DEFAULT_LAYOUT) {
      expect(Object.keys(tile).sort()).toEqual(["k", "w"]);
      expect(tile).not.toHaveProperty("migrateFrom");
      expect(tile).not.toHaveProperty("sinceVersion");
    }
  });
});
