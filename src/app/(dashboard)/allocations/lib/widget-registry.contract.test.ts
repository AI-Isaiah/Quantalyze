/**
 * M-0160 — structural contract test pinning that WIDGET_REGISTRY (metadata)
 * and WIDGET_COMPONENTS (lazy component barrel) stay in lock-step.
 *
 * Adding a widget to one map without the other is a silent runtime bug:
 *   - registry entry without a component → picker lists it, render crashes
 *     ("Unknown widget" / undefined component) on placement.
 *   - component without a registry entry → the widget is unreachable from the
 *     picker and carries no category/name/size metadata.
 *
 * Neither side has a compile-time link (both are `Record<string, ...>`), so
 * only a contract test catches the drift.
 *
 * NOTE on the audit finding's hard-coded counts: M-0160's suggested fix listed
 * "total count == 39" and per-category numbers (Performance 10, Risk 6, …).
 * Those were stale at the time this test was written — the live registry has
 * grown to 46 entries (Performance 11, Risk 7, Allocation 6, Attribution 3,
 * Positions 6, Monitoring 4, Intelligence 4, Meta 4, Outcomes 1). Hard-coding
 * the stale numbers would FAIL against correct, current code, so this test
 * pins the INVARIANTS that actually protect against drift — bidirectional key
 * parity and lock-step counts — rather than a brittle magic total that has to
 * be edited on every legitimate widget add. The category cross-check is
 * derived from WIDGET_CATEGORIES, not a hard-coded list.
 */
import { describe, it, expect } from "vitest";
import { WIDGET_REGISTRY, WIDGET_CATEGORIES } from "./widget-registry";
import { WIDGET_COMPONENTS } from "../widgets";

const registryKeys = Object.keys(WIDGET_REGISTRY).sort();
const componentKeys = Object.keys(WIDGET_COMPONENTS).sort();

describe("widget-registry ⇄ widget-components lock-step (M-0160)", () => {
  it("every WIDGET_REGISTRY key has a matching WIDGET_COMPONENTS key", () => {
    const missingComponent = registryKeys.filter(
      (k) => !(k in WIDGET_COMPONENTS),
    );
    expect(
      missingComponent,
      `registry ids with no lazy component: ${missingComponent.join(", ")}`,
    ).toEqual([]);
  });

  it("every WIDGET_COMPONENTS key has a matching WIDGET_REGISTRY entry", () => {
    const missingMeta = componentKeys.filter((k) => !(k in WIDGET_REGISTRY));
    expect(
      missingMeta,
      `lazy components with no registry metadata: ${missingMeta.join(", ")}`,
    ).toEqual([]);
  });

  it("the two maps expose the IDENTICAL key set (sorted equality)", () => {
    expect(componentKeys).toEqual(registryKeys);
  });

  it("the two maps have the same number of entries (lock-step count)", () => {
    expect(Object.keys(WIDGET_COMPONENTS).length).toBe(
      Object.keys(WIDGET_REGISTRY).length,
    );
  });

  it("each registry entry's `id` field equals its map key (no key/id drift)", () => {
    for (const key of registryKeys) {
      expect(
        WIDGET_REGISTRY[key].id,
        `WIDGET_REGISTRY['${key}'].id should equal its key`,
      ).toBe(key);
    }
  });
});

describe("widget-registry category integrity (M-0160)", () => {
  const declaredCategoryIds = new Set(WIDGET_CATEGORIES.map((c) => c.id));

  it("every category used by a registry entry is declared in WIDGET_CATEGORIES", () => {
    for (const key of registryKeys) {
      const cat = WIDGET_REGISTRY[key].category;
      expect(
        declaredCategoryIds.has(cat),
        `widget '${key}' uses category '${cat}' which is not in WIDGET_CATEGORIES`,
      ).toBe(true);
    }
  });

  it("WIDGET_CATEGORIES ids are unique (no duplicate category rows)", () => {
    const ids = WIDGET_CATEGORIES.map((c) => c.id);
    expect(ids.length).toBe(declaredCategoryIds.size);
  });

  it("every declared category has at least one widget (no orphan category rows in the picker)", () => {
    const usedCategories = new Set(
      registryKeys.map((k) => WIDGET_REGISTRY[k].category),
    );
    const orphanCategories = WIDGET_CATEGORIES.map((c) => c.id).filter(
      (id) => !usedCategories.has(id),
    );
    expect(
      orphanCategories,
      `categories with zero widgets: ${orphanCategories.join(", ")}`,
    ).toEqual([]);
  });
});
