import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

/**
 * Sidebar workspace-items regression tests.
 *
 * The v0.4.0 My Allocation pivot split allocator and
 * manager/crypto-team workspaces:
 *
 *   Allocator view: My Allocation → Scenarios → Recommendations.
 *     No Strategies (that's the manager surface). No Test Portfolios
 *     (Scenarios replaces the what-if concept). No separate Exchanges
 *     entry (inline in My Allocation).
 *
 *   Manager / crypto-team view: Strategies → Portfolios.
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

  it("renders 'Scenarios' (allocator-only what-if surface)", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.getByText("Scenarios")).toBeInTheDocument();
    const link = screen.getByText("Scenarios").closest("a");
    expect(link).toHaveAttribute("href", "/scenarios");
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
  it("renders Strategies + Portfolios for non-allocators", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={false} />);
    expect(screen.getByText("Strategies")).toBeInTheDocument();
    expect(screen.getByText("Portfolios")).toBeInTheDocument();
  });

  it("does NOT render allocator-only items for managers", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={false} />);
    expect(screen.queryByText("My Allocation")).toBeNull();
    expect(screen.queryByText("Connections")).toBeNull();
    expect(screen.queryByText("Scenarios")).toBeNull();
    expect(screen.queryByText("Recommendations")).toBeNull();
  });
});

describe("Sidebar workspace order — allocator view", () => {
  it("places 'My Allocation' before 'Scenarios'", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    const myAlloc = screen.getByText("My Allocation");
    const scenarios = screen.getByText("Scenarios");
    expect(
      myAlloc.compareDocumentPosition(scenarios) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("places 'Scenarios' before 'Recommendations'", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    const scenarios = screen.getByText("Scenarios");
    const recommendations = screen.getByText("Recommendations");
    expect(
      scenarios.compareDocumentPosition(recommendations) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
