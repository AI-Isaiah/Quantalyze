import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

/**
 * Sidebar label regression tests for the My Allocation restructure.
 * Three workspace items got renamed in PR 2 + a new Connections entry
 * was added. If a future refactor accidentally reverts any of these,
 * the allocator's mental model breaks (My Allocation = real book,
 * Test Portfolios = saved scenarios — the whole feature hinges on the
 * labels being right).
 */

// next/navigation is a client hook, stubbed out so the component
// renders in a vitest environment.
vi.mock("next/navigation", () => ({
  usePathname: () => "/allocations",
}));

describe("Sidebar workspace labels — allocator view", () => {
  it("renders 'My Allocation' as the first workspace entry", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
    // The link should point at /allocations, not /overview or /my-allocation.
    const link = screen.getByText("My Allocation").closest("a");
    expect(link).toHaveAttribute("href", "/allocations");
  });

  it("renders 'Test Portfolios' (not 'Portfolios')", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.getByText("Test Portfolios")).toBeInTheDocument();
    // The old "Portfolios" label must be gone for allocators.
    expect(screen.queryByText("Portfolios")).toBeNull();
    // Route is still /portfolios under the hood.
    const link = screen.getByText("Test Portfolios").closest("a");
    expect(link).toHaveAttribute("href", "/portfolios");
  });

  it("renders a 'Connections' entry pointing at /connections", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.getByText("Connections")).toBeInTheDocument();
    const link = screen.getByText("Connections").closest("a");
    expect(link).toHaveAttribute("href", "/connections");
  });

  it("the old 'Allocations' label is gone for allocators", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    // Would match both old and new, so we assert the NEW one is there
    // and there's no raw "Allocations" without "My ".
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
    expect(screen.queryByText(/^Allocations$/)).toBeNull();
  });
});

describe("Sidebar workspace labels — non-allocator view", () => {
  it("does NOT render the allocator-only entries for managers", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={false} />);
    // Allocator-only workspace items must be hidden.
    expect(screen.queryByText("My Allocation")).toBeNull();
    expect(screen.queryByText("Connections")).toBeNull();
    expect(screen.queryByText("Recommendations")).toBeNull();
    expect(screen.queryByText("Scenarios")).toBeNull();
    expect(screen.queryByText("Exchanges")).toBeNull();
    // But the universal workspace items remain.
    expect(screen.getByText("Strategies")).toBeInTheDocument();
    expect(screen.getByText("Test Portfolios")).toBeInTheDocument();
  });
});

describe("Sidebar workspace order", () => {
  it("places 'My Allocation' before 'Test Portfolios' for allocators", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    const myAlloc = screen.getByText("My Allocation");
    const testPortfolios = screen.getByText("Test Portfolios");
    // DOCUMENT_POSITION_FOLLOWING = 4 → testPortfolios comes after myAlloc.
    expect(
      myAlloc.compareDocumentPosition(testPortfolios) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("places 'Connections' after 'Test Portfolios' for allocators", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    const testPortfolios = screen.getByText("Test Portfolios");
    const connections = screen.getByText("Connections");
    expect(
      testPortfolios.compareDocumentPosition(connections) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
