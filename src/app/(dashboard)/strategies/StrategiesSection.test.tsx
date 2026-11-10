/**
 * Phase 199 plan 09 (D-02, T-199-11, T-199-33) - what StrategiesSection hands the shared table.
 *
 * The table has its own `allocatorFurniture` gate, so a page-level test cannot tell whether the
 * section ALSO withholds the Mark and Rename callbacks from a manager-only list: with the callbacks
 * wrongly passed, the table still renders nothing. This suite reads the props the section passes
 * (StrategyTable is replaced by a probe), so the first lock is pinned on its own, and the origin
 * the section forwards is pinned too (it is a required prop, never hard-coded).
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/(dashboard)/allocations/components/ContributionWizardOverlay", () => ({
  ContributionWizardOverlay: () => null,
}));

const seen = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
vi.mock("@/components/strategy/StrategyTable", () => ({
  StrategyTable: (props: Record<string, unknown>) => {
    seen.props = props;
    return null;
  },
}));

import { StrategiesSection } from "./StrategiesSection";

function mount(extra: Partial<React.ComponentProps<typeof StrategiesSection>> = {}) {
  render(
    <StrategiesSection
      strategies={[]}
      origin={{ key: "strategies" }}
      {...extra}
    />,
  );
  return seen.props as Record<string, unknown>;
}

describe("StrategiesSection props to the table (199-09)", () => {
  it("passes Mark and Rename callbacks only under allocatorFurniture", () => {
    const manager = mount({ allocatorFurniture: false });
    expect(manager.onMarkOwnership).toBeUndefined();
    expect(manager.onRename).toBeUndefined();
    expect(manager.allocatorFurniture).toBe(false);

    const defaulted = mount();
    expect(defaulted.onMarkOwnership).toBeUndefined();
    expect(defaulted.onRename).toBeUndefined();

    const allocator = mount({ allocatorFurniture: true });
    expect(typeof allocator.onMarkOwnership).toBe("function");
    expect(typeof allocator.onRename).toBe("function");
    expect(allocator.allocatorFurniture).toBe(true);
  });

  it("forwards the page's origin and takes its prefs scope from it, hard-coding neither (R-04)", () => {
    const merged = mount({ origin: { key: "strategies" } });
    expect(merged.origin).toEqual({ key: "strategies" });
    expect(merged.categorySlug).toBe("strategies");

    const other = mount({ origin: { key: "allocations" } });
    expect(other.origin).toEqual({ key: "allocations" });
    expect(other.categorySlug).toBe("allocations");
  });

  it("keeps the owner widening and forwards managerRows and initialSort untouched", () => {
    const managerRows = { a: { editHref: "/strategies/a/edit" } };
    const p = mount({ managerRows, initialSort: { key: "created_at", dir: "desc" } });
    expect(p.visibility).toBe("owner-all-statuses");
    expect(p.managerRows).toBe(managerRows);
    expect(p.initialSort).toEqual({ key: "created_at", dir: "desc" });
  });
});
