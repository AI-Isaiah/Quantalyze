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
 *     hrefs (there is no /bridge route, verified in 45-RESEARCH Pitfall 1;
 *     Bridge deep-links the Scenario tab `/allocations?tab=scenario`, where the
 *     composer's "Open Bridge" card → BridgeDrawer lives — see buildPrimaryMobileNav
 *     in Sidebar.tsx);
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
    expect(hrefs).toContain("/allocations?tab=scenario");
    // The SC#1 trio leads the list (My Allocation, Risk, Bridge in order).
    expect(hrefs.slice(0, 3)).toEqual([
      "/allocations",
      "/allocations?tab=risk",
      "/allocations?tab=scenario",
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
    expect(hrefs).not.toContain("/allocations?tab=scenario");
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
      "/allocations?tab=scenario",
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
      "/allocations?tab=scenario",
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
    expect(hrefs).toContain("/allocations?tab=scenario");
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
    // The inactive branch (aria-current={active ? "page" : undefined}): the
    // Risk and Bridge cells keep the query string in their hrefs, which the
    // stripped pathname `/allocations` never contains, so they must NOT be
    // marked active even though they live under /allocations* (pins the
    // documented query-stripping tradeoff so a regression that lit every cell
    // — or the wrong cell — on a non-matching pathname fails here).
    const risk = within(nav).getByText("Risk").closest("a");
    const bridge = within(nav).getByText("Bridge").closest("a");
    const profile = within(nav).getByText("Profile").closest("a");
    expect(risk).not.toHaveAttribute("aria-current");
    expect(bridge).not.toHaveAttribute("aria-current");
    expect(profile).not.toHaveAttribute("aria-current");
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

  it("caps the badge TEXT at '99+' for counts over 99 (CF-06 — pill can't overflow its cell)", () => {
    // v1.3 P3 follow-up: an unbounded count widened the pill enough to overlap
    // the adjacent cell on a 320px 5-item admin layout. The DISPLAYED text is
    // now capped at three glyphs; the aria-label keeps the TRUE count for AT.
    pathnameMock.mockReturnValue("/allocations");
    const { rerender } = render(<MobileNav isAllocator flaggedCount={150} />);
    let nav = screen.getByRole("navigation", { name: "Primary mobile" });
    // Visible pill text is capped — this FAILS against the pre-cap code (rendered "150").
    expect(within(nav).getByText("99+")).toBeInTheDocument();
    expect(within(nav).queryByText("150")).toBeNull();
    // The aria-label still names the honest count for assistive tech.
    expect(within(nav).getByLabelText("150 flagged holdings")).toBeInTheDocument();

    // Boundary: exactly 99 is NOT capped.
    rerender(<MobileNav isAllocator flaggedCount={99} />);
    nav = screen.getByRole("navigation", { name: "Primary mobile" });
    expect(within(nav).getByText("99")).toBeInTheDocument();
    expect(within(nav).queryByText("99+")).toBeNull();

    // Small counts render verbatim.
    rerender(<MobileNav isAllocator flaggedCount={5} />);
    nav = screen.getByRole("navigation", { name: "Primary mobile" });
    expect(within(nav).getByText("5")).toBeInTheDocument();
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
