import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { buildPrimaryMobileNav } from "./Sidebar";
import { MobileNav } from "./MobileNav";

/**
 * Phase 45 Plan 01 (NAV-01) — role-aware mobile bottom nav.
 *
 * The bottom nav is single-sourced from `buildPrimaryMobileNav` in Sidebar.tsx
 * (DRY / project Rule 6) so the desktop Sidebar and the mobile bottom nav never
 * drift. These tests pin:
 *   - the role OR-logic (showsAllocatorWorkspace = isAllocator || isAdmin etc.)
 *     so an allocator never gets manager/admin-only destinations and vice-versa
 *     (T-45-01 information-disclosure mitigation in the plan threat register);
 *   - the SC#1 allocator head — My Allocation / Risk / Bridge with DISTINCT
 *     hrefs (Bridge deep-links the BridgeWidget on the Risk tab — there is no
 *     /bridge route, verified in 45-RESEARCH Pitfall 1);
 *   - role "both" lighting the allocator set (NOT the pre-fix !isAllocator
 *     short-circuit);
 *   - the <=5 cap;
 *   - the flagged-holdings badge wiring.
 *
 * They exist so the new role branches are covered (45-RESEARCH Pitfall 5 — the
 * coverage ratchet's branches floor is 72 and must hold un-lowered).
 */

const pathnameMock = vi.fn(() => "/allocations");
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

describe("buildPrimaryMobileNav — role branches (NAV-01)", () => {
  it("allocator-only: heads with My Allocation, Risk, Bridge (distinct hrefs), <=5", () => {
    const items = buildPrimaryMobileNav({ isAllocator: true });
    const hrefs = items.map((i) => i.href);
    expect(items.length).toBeLessThanOrEqual(5);
    // SC#1 trio present.
    expect(hrefs).toContain("/allocations");
    expect(hrefs).toContain("/allocations?tab=risk");
    expect(hrefs).toContain("/allocations?tab=risk#bridge");
    // The SC#1 trio leads the list (My Allocation, Risk, Bridge in order).
    expect(hrefs.slice(0, 3)).toEqual([
      "/allocations",
      "/allocations?tab=risk",
      "/allocations?tab=risk#bridge",
    ]);
    // Every href distinct — no two items resolve to the identical URL.
    expect(new Set(hrefs).size).toBe(hrefs.length);
    // Labels match the buildNavSections copy verbatim.
    const labels = items.map((i) => i.label);
    expect(labels).toContain("My Allocation");
    expect(labels).toContain("Risk");
    expect(labels).toContain("Bridge");
    // Profile is always present (ACCOUNT).
    expect(labels).toContain("Profile");
    // Allocator must NOT get manager-only destinations.
    expect(hrefs).not.toContain("/strategies");
    expect(hrefs).not.toContain("/portfolios");
    // Every item carries the NavItem shape.
    for (const item of items) {
      expect(typeof item.label).toBe("string");
      expect(typeof item.href).toBe("string");
      expect(typeof item.icon).toBe("function");
    }
  });

  it("manager-only: Strategies + Portfolios + Profile; no allocator items; <=5", () => {
    const items = buildPrimaryMobileNav({ isManager: true });
    const hrefs = items.map((i) => i.href);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(hrefs).toContain("/strategies");
    expect(hrefs).toContain("/portfolios");
    expect(hrefs).toContain("/profile");
    // No allocator destinations leak into a manager's bottom nav.
    expect(hrefs).not.toContain("/allocations");
    expect(hrefs).not.toContain("/allocations?tab=risk");
    expect(hrefs).not.toContain("/allocations?tab=risk#bridge");
  });

  it("admin: EXACT <=5 set — SC#1 trio + one manager dest + Profile; Portfolios/Discovery trimmed to the drawer", () => {
    const items = buildPrimaryMobileNav({ isAdmin: true });
    const hrefs = items.map((i) => i.href);
    // Pin the EXACT set + ORDER so a reorder of the priority array can't
    // silently change which destination is dropped at the <=5 cap (WR-02).
    // budget = CAP(5) - 1 reserved for Profile = 4 → [My Allocation, Risk,
    // Bridge, Strategies] then Profile; Portfolios + Discovery overflow to the
    // hamburger drawer (the full nav) by design.
    expect(hrefs).toEqual([
      "/allocations",
      "/allocations?tab=risk",
      "/allocations?tab=risk#bridge",
      "/strategies",
      "/profile",
    ]);
    // Portfolios + Discovery are INTENTIONALLY absent from the bottom nav
    // (reachable via the drawer) — assert the drop so it stays deliberate.
    expect(hrefs).not.toContain("/portfolios");
    expect(hrefs).not.toContain("/discovery");
    // Distinct hrefs even when both families are present.
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('role "both" (isAllocator && isManager): EXACT set equals admin — allocator set lit, Portfolios trimmed', () => {
    const items = buildPrimaryMobileNav({ isAllocator: true, isManager: true });
    const hrefs = items.map((i) => i.href);
    // The allocator head lights (NOT the pre-fix !isAllocator short-circuit),
    // and the resolved set is identical to admin (same OR-logic). Pinned so a
    // priority reorder that silently dropped a different item is caught (WR-02).
    expect(hrefs).toEqual([
      "/allocations",
      "/allocations?tab=risk",
      "/allocations?tab=risk#bridge",
      "/strategies",
      "/profile",
    ]);
    expect(hrefs).not.toContain("/portfolios");
  });

  it("no roles: only the always-present Profile item", () => {
    const items = buildPrimaryMobileNav({});
    expect(items.map((i) => i.href)).toEqual(["/profile"]);
  });

  it("My Allocation carries the flaggedCount badge when > 0", () => {
    const withBadge = buildPrimaryMobileNav({ isAllocator: true, flaggedCount: 3 });
    const myAlloc = withBadge.find((i) => i.href === "/allocations");
    expect(myAlloc?.badge).toBe(3);

    const noBadge = buildPrimaryMobileNav({ isAllocator: true, flaggedCount: 0 });
    const myAlloc0 = noBadge.find((i) => i.href === "/allocations");
    // 0 must not render a badge (the cell only shows it when > 0).
    expect(myAlloc0?.badge ?? 0).toBe(0);
  });
});

describe("MobileNav — role-aware rendering (NAV-01 / SC#4)", () => {
  it("renders the allocator trio as labeled, reachable links", () => {
    pathnameMock.mockReturnValue("/allocations");
    render(<MobileNav isAllocator />);
    const nav = screen.getByRole("navigation", { name: "Primary mobile" });
    const links = within(nav).getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/allocations");
    expect(hrefs).toContain("/allocations?tab=risk");
    expect(hrefs).toContain("/allocations?tab=risk#bridge");
    expect(within(nav).getByText("My Allocation")).toBeInTheDocument();
    expect(within(nav).getByText("Bridge")).toBeInTheDocument();
    expect(within(nav).getByText("Risk")).toBeInTheDocument();
  });

  it("does NOT render a hardcoded TABS list — manager sees only their set", () => {
    pathnameMock.mockReturnValue("/strategies");
    render(<MobileNav isManager />);
    const nav = screen.getByRole("navigation", { name: "Primary mobile" });
    expect(within(nav).getByText("Strategies")).toBeInTheDocument();
    expect(within(nav).getByText("Portfolios")).toBeInTheDocument();
    // The old role-blind stub surfaced Discovery to everyone — it must be gone
    // for a manager (Discovery is the allocator's browse surface).
    expect(within(nav).queryByText("My Allocation")).toBeNull();
  });

  it("marks the active item with aria-current=page (pathname-prefix match)", () => {
    pathnameMock.mockReturnValue("/allocations");
    render(<MobileNav isAllocator />);
    const nav = screen.getByRole("navigation", { name: "Primary mobile" });
    const myAlloc = within(nav).getByText("My Allocation").closest("a");
    expect(myAlloc).toHaveAttribute("aria-current", "page");
  });

  it("gives every bottom-nav target a >=44px min height (WCAG 2.5.8)", () => {
    pathnameMock.mockReturnValue("/allocations");
    render(<MobileNav isAllocator />);
    const nav = screen.getByRole("navigation", { name: "Primary mobile" });
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.className).toContain("min-h-[44px]");
    }
  });

  it("renders the My Allocation flagged badge when flaggedCount > 0", () => {
    pathnameMock.mockReturnValue("/allocations");
    render(<MobileNav isAllocator flaggedCount={2} />);
    expect(screen.getByLabelText("2 flagged holdings")).toBeInTheDocument();
  });

  it("applies inert to the nav when the drawer is open (NAV-03 background containment)", () => {
    pathnameMock.mockReturnValue("/allocations");
    // inert={true}: the bottom nav (a sibling of the inert <main>) is removed
    // from the tab order + AT tree behind the open-drawer backdrop.
    const { rerender } = render(<MobileNav isAllocator inert />);
    let nav = screen.getByRole("navigation", { name: "Primary mobile" });
    expect(nav).toHaveAttribute("inert");
    // inert={false}: normal interactive bottom nav when the drawer is closed.
    rerender(<MobileNav isAllocator inert={false} />);
    nav = screen.getByRole("navigation", { name: "Primary mobile" });
    expect(nav).not.toHaveAttribute("inert");
  });
});
