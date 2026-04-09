import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

/**
 * Sidebar workspace-items regression tests.
 *
 * The v0.4.0 My Allocation pivot split allocator and
 * manager/crypto-team workspaces:
 *
 *   Allocator view: My Allocation → Connections → Scenarios → Recommendations.
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

  it("renders 'Connections' pointing at /connections", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.getByText("Connections")).toBeInTheDocument();
    const link = screen.getByText("Connections").closest("a");
    expect(link).toHaveAttribute("href", "/connections");
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
  it("places 'My Allocation' before 'Connections'", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    const myAlloc = screen.getByText("My Allocation");
    const connections = screen.getByText("Connections");
    expect(
      myAlloc.compareDocumentPosition(connections) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("places 'Connections' before 'Scenarios'", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    const connections = screen.getByText("Connections");
    const scenarios = screen.getByText("Scenarios");
    expect(
      connections.compareDocumentPosition(scenarios) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
