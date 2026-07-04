import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

/**
 * Sidebar workspace-items regression tests.
 *
 * 2026-05-20 simplification: the allocator workspace collapsed to a
 * single entry "My Allocation". Scenarios and Recommendations used to
 * be top-level routes but were folded — Scenarios into a TAB inside the
 * My Allocation page, Recommendations dropped from the nav.
 *
 * 51-REVIEW override (2026-06-28): the user OVERRODE the Recommendations
 * half of that decision. Recommendations is again a top-level allocator
 * nav item (alongside Compare + Decks) so the daily match output is not a
 * dead-end. Scenarios stays a tab (its top-level route is a redirect-stub).
 *
 *   Allocator view: My Allocation + Recommendations + Compare + Decks.
 *     (Discovery + Account handle the rest. No Strategies, no Portfolios,
 *     no Scenarios top-level entry.)
 *
 *   Manager / crypto-team view: Strategies → Portfolios.
 *
 *   Admin view: My Allocation + Strategies + Portfolios. Admins need
 *     access to both surfaces for triage / demo / QA.
 *
 * If a future refactor collapses these back together or flips the
 * labels, these tests catch it.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/allocations",
}));

describe("Sidebar workspace — allocator view", () => {
  it("renders 'My Allocation' as the first workspace entry", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
    const link = screen.getByText("My Allocation").closest("a");
    expect(link).toHaveAttribute("href", "/allocations");
  });

  it("does NOT render a 'Connections' entry in the allocator workspace", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    // /connections was removed in v0.15.0.0 — the relationship view is
    // collapsing into the wider allocator surfaces rather than living on
    // its own route.
    expect(screen.queryByText("Connections")).toBeNull();
  });

  it("does NOT render 'Scenarios' as a top-level entry (it's a tab inside My Allocation)", () => {
    // 2026-05-20: Scenarios used to be a top-level sidebar entry pointing
    // at /scenarios, but the actual surface is a tab inside My Allocation
    // (AllocationsTabs scenario panel). The top-level entry was duplication.
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.queryByText("Scenarios")).toBeNull();
  });

  it("renders 'Recommendations' as a top-level allocator entry (51-REVIEW override)", () => {
    // 51-REVIEW user override (2026-06-28): the 2026-05-20 simplification left
    // Recommendations OUT of the nav (treated as a tab/CTA-only surface). The
    // user OVERRODE that decision — Recommendations is now a top-level allocator
    // nav item so the daily match output is not a dead-end. It lives INSIDE the
    // showsAllocatorWorkspace branch (role-leak pinned by T-45-01 below).
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    const link = screen.getByText("Recommendations").closest("a");
    expect(link).toHaveAttribute("href", "/recommendations");
  });

  it("does NOT render 'Strategies' in the allocator workspace", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    // "Strategies" is the manager/crypto-team surface, not an allocator one.
    // The allocator browses published strategies via the Discovery group.
    expect(screen.queryByText("Strategies")).toBeNull();
  });

  it("does NOT render 'Test Portfolios' or 'Portfolios' in the allocator workspace", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.queryByText("Test Portfolios")).toBeNull();
    expect(screen.queryByText("Portfolios")).toBeNull();
  });

  it("does NOT render a top-level 'Allocations' label for allocators", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    // The old label was "Allocations" (plural). It was renamed to
    // "My Allocation" (singular) in the v0.4.0 pivot.
    expect(screen.queryByText(/^Allocations$/)).toBeNull();
  });
});

/**
 * FLOW-03 (Phase 32) — the "Strategy Sandbox" nav item (→ /scenarios) is
 * RETIRED. The standalone SURF-02/03 Sandbox entry was removed when the
 * example-universe Sandbox was absorbed into the unified composer (Phase 29)
 * and /scenarios was converted to a 307 redirect to /allocations?tab=scenario.
 * The allocator now has ONE discoverable nav entry ("My Allocation" →
 * /allocations). The retirement is pinned durably by
 * src/__tests__/phase-32-frozen-spine-guards.test.ts (no "/scenarios" in
 * Sidebar.tsx). This block asserts no role flavour resurrects the item.
 */
describe("Sidebar Strategy Sandbox nav item is retired (FLOW-03)", () => {
  it("allocators do NOT see a 'Strategy Sandbox' link", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.queryByText("Strategy Sandbox")).toBeNull();
  });

  it("manager-only users do NOT see a 'Strategy Sandbox' link", () => {
    render(
      <Sidebar populatedSlugs={[]} isAllocator={false} isManager={true} />,
    );
    expect(screen.queryByText("Strategy Sandbox")).toBeNull();
  });

  it("admin-only users do NOT see a 'Strategy Sandbox' link", () => {
    render(<Sidebar populatedSlugs={[]} isAdmin={true} />);
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
    expect(screen.queryByText("Strategy Sandbox")).toBeNull();
  });

  it("a dual-role admin+allocator does NOT see a 'Strategy Sandbox' link", () => {
    render(<Sidebar populatedSlugs={[]} isAdmin={true} isAllocator={true} />);
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
    expect(screen.queryByText("Strategy Sandbox")).toBeNull();
  });

  it("users with no role flags do NOT see a 'Strategy Sandbox' link", () => {
    render(<Sidebar populatedSlugs={[]} />);
    expect(screen.queryByText("Strategy Sandbox")).toBeNull();
  });
});

describe("Sidebar workspace — manager / crypto-team view", () => {
  it("renders Strategies + Portfolios for managers", () => {
    render(
      <Sidebar populatedSlugs={[]} isAllocator={false} isManager={true} />,
    );
    expect(screen.getByText("Strategies")).toBeInTheDocument();
    expect(screen.getByText("Portfolios")).toBeInTheDocument();
  });

  it("does NOT render allocator-only items for managers", () => {
    render(
      <Sidebar populatedSlugs={[]} isAllocator={false} isManager={true} />,
    );
    expect(screen.queryByText("My Allocation")).toBeNull();
    expect(screen.queryByText("Connections")).toBeNull();
    expect(screen.queryByText("Scenarios")).toBeNull();
    // 51-REVIEW override: Recommendations is now a top-level ALLOCATOR nav item
    // (it lives inside the showsAllocatorWorkspace branch). A manager-only user
    // must therefore NOT see it — this is the role-leak pin for the new entry
    // (T-45-01 info-disclosure), not a "Recommendations isn't a route" assertion.
    expect(screen.queryByText("Recommendations")).toBeNull();
  });

  it("does NOT render the Discovery rail for pure managers (allocator-only surface)", () => {
    // Issue #8: managers were seeing the Discovery sub-groups. Discovery
    // is the allocator's browse-investable-strategies surface; it is
    // irrelevant to a strategy manager and was the most concrete instance
    // of "options that don't apply" reported in dogfooding.
    render(
      <Sidebar
        populatedSlugs={["crypto-sma", "cfd"]}
        isAllocator={false}
        isManager={true}
      />,
    );
    expect(screen.queryByText("DISCOVERY")).toBeNull();
  });
});

describe("Sidebar workspace — dual-role (manager + allocator)", () => {
  it("renders BOTH workspaces when role='both' (issue #8)", () => {
    // Pre-fix the predicate was `!isAllocator || isAdmin` for the manager
    // rail, so an `isAllocator=true` user lost Strategies/Portfolios
    // entirely — silently nuking the manager half of a role='both'
    // signup. The explicit `isManager` flag isolates the two surfaces.
    render(
      <Sidebar
        populatedSlugs={[]}
        isAllocator={true}
        isManager={true}
      />,
    );
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
    expect(screen.getByText("Strategies")).toBeInTheDocument();
    expect(screen.getByText("Portfolios")).toBeInTheDocument();
  });
});

describe("Sidebar workspace — admin view", () => {
  it("renders 'My Allocation' AND the manager surfaces so admins can triage either", () => {
    // Pre-fix the rule was `isAllocator && !isAdmin`, which hid My
    // Allocation from admins (even admin-allocators). Admins now see
    // both surfaces so they can navigate any user-facing route.
    render(<Sidebar populatedSlugs={[]} isAdmin={true} />);
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
    expect(screen.getByText("Strategies")).toBeInTheDocument();
    expect(screen.getByText("Portfolios")).toBeInTheDocument();
  });

  it("dual-role (admin + allocator) sees both surfaces", () => {
    render(
      <Sidebar populatedSlugs={[]} isAdmin={true} isAllocator={true} />,
    );
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
    expect(screen.getByText("Strategies")).toBeInTheDocument();
    expect(screen.getByText("Portfolios")).toBeInTheDocument();
  });
});

/**
 * M-0414 (audit-2026-05-07) — the ADMIN nav section itself.
 *
 * Prior tests pass isAdmin={true} only to assert the workspace surfaces
 * (My Allocation + Strategies + Portfolios). None of them assert the
 * admin-only section spread on Sidebar.tsx:89-100 (`...(isAdmin ? [...]
 * : [])`). A regression that flips that guard to `!isAdmin` — leaking
 * admin routes to every user, or hiding them from admins — would slip
 * past the existing suite. These pin both directions.
 */
describe("Sidebar ADMIN section RBAC gate (M-0414)", () => {
  // The five admin-only destinations from the section spread. "Dashboard"
  // is deliberately excluded from the assertion set: its label is generic
  // and could collide; the other four are unambiguous admin routes.
  const ADMIN_ONLY_LABELS = [
    "Users",
    "Deletion requests",
    "Match queue",
    "For-quants leads",
  ] as const;

  it("renders the ADMIN heading and admin-only links when isAdmin=true", () => {
    render(<Sidebar populatedSlugs={[]} isAdmin={true} />);
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
    for (const label of ADMIN_ONLY_LABELS) {
      const node = screen.getByText(label);
      expect(node).toBeInTheDocument();
    }
    // The admin Match-queue link points at /admin/match (not the public route).
    expect(screen.getByText("Match queue").closest("a")).toHaveAttribute(
      "href",
      "/admin/match",
    );
  });

  it("does NOT render the ADMIN section for a non-admin allocator", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.queryByText("ADMIN")).toBeNull();
    for (const label of ADMIN_ONLY_LABELS) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("does NOT render the ADMIN section for a non-admin manager", () => {
    render(
      <Sidebar populatedSlugs={[]} isManager={true} isAllocator={false} />,
    );
    expect(screen.queryByText("ADMIN")).toBeNull();
    expect(screen.queryByText("Deletion requests")).toBeNull();
  });

  it("an admin who is also an allocator still gets My Allocation AND the ADMIN section", () => {
    // The isAdmin+isAllocator combination must light up both the allocator
    // workspace and the admin section — neither flag suppresses the other.
    render(
      <Sidebar populatedSlugs={[]} isAdmin={true} isAllocator={true} />,
    );
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
    expect(screen.getByText("Deletion requests")).toBeInTheDocument();
  });
});

/**
 * Phase 66 CF-06 — the flagged-count badge is capped at "99+" on the desktop
 * rail (the counterpart to the MobileNav.test.tsx cap). An unbounded count
 * widened the pill enough to overlap the adjacent cell on the 320px 5-item
 * admin layout (v1.3 P3 follow-up). Capping the DISPLAYED text is the fix; the
 * aria-label keeps the true count for assistive tech.
 */
describe("Sidebar flagged-count badge cap (CF-06)", () => {
  it("caps the badge TEXT at '99+' for counts over 99", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} flaggedCount={150} />);
    // Visible pill text capped — FAILS against pre-cap code (rendered "150").
    expect(screen.getByText("99+")).toBeInTheDocument();
    expect(screen.queryByText("150")).toBeNull();
    // aria-label keeps the honest count.
    expect(screen.getByLabelText("150 flagged holdings")).toBeInTheDocument();
  });

  it("renders exactly '99' at the boundary (not capped)", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} flaggedCount={99} />);
    expect(screen.getByText("99")).toBeInTheDocument();
    expect(screen.queryByText("99+")).toBeNull();
  });

  it("renders a small count verbatim", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} flaggedCount={5} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});

describe("Sidebar workspace — no role flags (defense-in-depth)", () => {
  it("renders NO workspace items when isAllocator + isManager + isAdmin are all unset", () => {
    // Issue #8 follow-up: the workspace flags are now explicit. A user
    // with no role flags (anonymous in tests, or a profile mid-bootstrap)
    // gets an empty workspace section rather than a default "manager"
    // assumption. The pre-fix `!isAllocator` short-circuit silently
    // surfaced manager links to anyone whose isAllocator was falsy —
    // including unauthenticated and pre-onboarding users.
    render(<Sidebar populatedSlugs={[]} />);
    expect(screen.queryByText("My Allocation")).toBeNull();
    expect(screen.queryByText("Strategies")).toBeNull();
    expect(screen.queryByText("Portfolios")).toBeNull();
  });
});

/**
 * Discovery sub-groups — per the Allocator Dashboard design handoff.
 *
 * Discovery lives under a single "DISCOVERY" heading with two
 * sub-group labels inside: "Digital Assets" (crypto SMA / CFD /
 * emerging crypto / crypto decks) and "TradFi" (TradFi decks).
 * This mirrors how allocators already think about strategy sourcing —
 * crypto vs traditional finance — and avoids a flat list that grows
 * unboundedly as new categories land.
 */
describe("Sidebar Discovery sub-groups", () => {
  it("renders a single 'DISCOVERY' heading, not one per group", () => {
    render(<Sidebar isAllocator={true} />);
    expect(screen.getAllByText("DISCOVERY")).toHaveLength(1);
  });

  it("renders 'Digital Assets' and 'TradFi' sub-group labels under Discovery", () => {
    render(<Sidebar isAllocator={true} />);
    expect(screen.getByText("Digital Assets")).toBeInTheDocument();
    expect(screen.getByText("TradFi")).toBeInTheDocument();
  });

  it("places 'Digital Assets' before 'TradFi'", () => {
    render(<Sidebar isAllocator={true} />);
    const digital = screen.getByText("Digital Assets");
    const tradfi = screen.getByText("TradFi");
    expect(
      digital.compareDocumentPosition(tradfi) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("groups 'Crypto SMA' under the 'Digital Assets' sub-group and 'TradFi Decks' under 'TradFi'", () => {
    render(<Sidebar isAllocator={true} />);
    const digital = screen.getByText("Digital Assets");
    const tradfi = screen.getByText("TradFi");
    const cryptoSma = screen.getByText("Crypto SMA");
    const tradfiDecks = screen.getByText("TradFi Decks");
    // Crypto SMA falls between the two sub-group labels.
    expect(
      digital.compareDocumentPosition(cryptoSma) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      cryptoSma.compareDocumentPosition(tradfi) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // TradFi Decks comes after the TradFi sub-group label.
    expect(
      tradfi.compareDocumentPosition(tradfiDecks) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides the entire Discovery section when no categories are populated", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.queryByText("DISCOVERY")).toBeNull();
    expect(screen.queryByText("Digital Assets")).toBeNull();
    expect(screen.queryByText("TradFi")).toBeNull();
  });

  it("hides a sub-group that becomes empty after populatedSlugs filtering", () => {
    // Only digital-assets slugs are populated — the TradFi sub-group
    // should disappear entirely rather than render an empty header.
    render(
      <Sidebar
        populatedSlugs={["crypto-sma", "cfd"]}
        isAllocator={true}
      />,
    );
    expect(screen.getByText("Digital Assets")).toBeInTheDocument();
    expect(screen.queryByText("TradFi")).toBeNull();
    expect(screen.queryByText("TradFi Decks")).toBeNull();
  });
});

/**
 * Phase 51 NAV-02 / UI-SPEC §Item state contract — the desktop NavItemLink a11y
 * gaps.
 *
 * The module-scope usePathname mock returns "/allocations", so the
 * "My Allocation" entry (href "/allocations") is the ACTIVE item in every
 * render below.
 *
 * RED CONTRACT (plan 51-01): today's NavItemLink (Sidebar.tsx L301-334) has NO
 * `aria-current` and NO focus-visible affordance on its <Link>. These two
 * assertions FAIL now; plan 51-03 mirrors MobileNav.tsx's
 * `aria-current={active ? "page" : undefined}` + focus-visible ring (accent on
 * the dark rail) onto NavItemLink, turning them GREEN. The active rule stays
 * `pathname === href || pathname.startsWith(href + "/")` — the SSR-safe
 * pathname-prefix match; no query-param hook / CSR-bailout is introduced.
 */
describe("Sidebar NavItemLink a11y (NAV-02, RED until 51-03)", () => {
  it("marks the ACTIVE nav link with aria-current=page", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    // usePathname() === "/allocations" → My Allocation is active.
    const active = screen.getByText("My Allocation").closest("a");
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("gives the nav link a WCAG-AA-contrast focus ring on the dark rail (NOT accent)", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    const link = screen.getByText("My Allocation").closest("a");
    expect(link).not.toBeNull();
    const className = link?.getAttribute("class") ?? "";
    // Keyboard-only focus affordance via focus-visible (never bare focus:). The
    // ring MUST clear the WCAG 1.4.11 / 2.4.11 3:1 non-text-contrast floor against
    // the navy rail (bg-sidebar #0F172A / -hover #1E293B / -active #334155). The
    // accent token #1B6B5A measured 2.8:1 / 2.3:1 / 1.63:1 there — all FAIL — so
    // the rail ring is intentionally WHITE (ring-white, >9:1 on every state) with a
    // navy ring-offset, NOT accent. This is the dark-rail counterpart to the
    // Breadcrumb ring, which keeps the accent token because it renders on the light
    // page bg (6:1, passes). Pin both the focus-visible keyword AND that the rail
    // ring is white-not-accent so a future "consistency" refactor can't silently
    // reintroduce the contrast regression.
    expect(className).toMatch(/focus-visible:/);
    expect(className).toMatch(/ring-white/);
    expect(className).not.toMatch(/ring-accent/);
  });
});

/**
 * T-45-01 (info-disclosure) — the role OR-logic PIN. This block locks the
 * existing-correct behavior so any 51-03 nav-completeness edit that leaks an
 * allocator-only surface to a manager (or vice-versa) turns this red.
 *
 * GREEN NOW (it pins live-correct behavior, NOT a future implementation): the
 * `showsAllocatorWorkspace = isAllocator || isAdmin` /
 * `showsManagerWorkspace = isManager || isAdmin` derivations in
 * buildNavSections (Sidebar.tsx L34-35) already gate "My Allocation" (allocator
 * surface) vs "Strategies"/"Portfolios" (manager surface) correctly. The mobile
 * twin (buildPrimaryMobileNav) is already pinned by MobileNav.test.tsx; this is
 * the DESKTOP-render pin for the same security property.
 */
describe("Sidebar role OR-logic pin — T-45-01 (GREEN, must not regress)", () => {
  it("a manager-only user does NOT see the allocator-only 'My Allocation' entry", () => {
    render(
      <Sidebar populatedSlugs={[]} isManager={true} isAllocator={false} />,
    );
    // Manager surface present...
    expect(screen.getByText("Strategies")).toBeInTheDocument();
    expect(screen.getByText("Portfolios")).toBeInTheDocument();
    // ...but the allocator-only workspace entry must NOT leak to a manager.
    expect(screen.queryByText("My Allocation")).toBeNull();
  });

  it("an allocator DOES see 'My Allocation' but NOT the manager-only entries", () => {
    render(
      <Sidebar populatedSlugs={[]} isAllocator={true} isManager={false} />,
    );
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
    // The manager surface must NOT leak to a pure allocator.
    expect(screen.queryByText("Strategies")).toBeNull();
    expect(screen.queryByText("Portfolios")).toBeNull();
  });
});
