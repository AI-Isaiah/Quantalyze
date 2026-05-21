import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

/**
 * Sidebar workspace-items regression tests.
 *
 * 2026-05-20 simplification: the allocator workspace collapsed to a
 * single entry "My Allocation". Scenarios and Recommendations used to
 * be top-level routes but are now TABS inside the My Allocation page —
 * a sidebar entry would duplicate navigation that already happens via
 * AllocationsTabs.
 *
 *   Allocator view: My Allocation. (Just that — Discovery + Account
 *     handle the rest. No Strategies, no Portfolios, no Scenarios, no
 *     Recommendations top-level entries.)
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

  it("does NOT render 'Recommendations' as a top-level entry (tab inside My Allocation)", () => {
    // Same 2026-05-20 simplification — Recommendations lives as a tab/view
    // inside the My Allocation surface, not a separate route.
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.queryByText("Recommendations")).toBeNull();
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
