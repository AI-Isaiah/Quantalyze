import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExchangesTabContent } from "./ExchangesTabContent";

/**
 * Phase 200 round-1 WR-02: D-06 opened the API keys tab to every role, and the intro was
 * allocator-only copy. A manager's keys feed strategies; none of the allocator-side
 * behaviour the intro promised (Active Allocation, invest/divest detection) happens for them.
 */

vi.mock("@/components/exchanges/AllocatorExchangeManager", () => ({
  AllocatorExchangeManager: () => <div data-testid="manager-stub" />,
}));

const ALLOCATOR_INTRO = /build your allocation\. No manual data entry/;

function renderFor(role: "manager" | "allocator" | "both") {
  return render(
    <ExchangesTabContent initialKeys={[]} activePortfolio={null} hasHoldings={null} role={role} />,
  );
}

describe("ExchangesTabContent intro (WR-02)", () => {
  it("MANAGER-INTRO: a manager is told what their keys do, never about Active Allocation or invest/divest", () => {
    const { container } = renderFor("manager");
    expect(container.querySelector("p")).toHaveTextContent(
      "Read-only exchange API keys your strategies read trades from.",
    );
    expect(document.body.textContent).not.toMatch(/Active Allocation/);
    expect(document.body.textContent).not.toMatch(/invest and divest/);
  });

  it.each(["allocator", "both"] as const)("%s keeps the allocator intro", (role) => {
    renderFor(role);
    expect(screen.getByText(ALLOCATOR_INTRO)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/invest and divest events are detected/);
  });
});

// Phase 201 D-04: the allocator's live holdings are an "allocation", and the link back to the
// dashboard uses the sentence-case canonical name from Interaction contract 3.
describe("ExchangesTabContent live-holdings card (D-04)", () => {
  function renderWithPortfolio() {
    return render(
      <ExchangesTabContent
        initialKeys={[]}
        activePortfolio={{ id: "p1", name: "Active Allocation" }}
        hasHoldings
        role="allocator"
      />,
    );
  }

  it("names the card an allocation and links to Open My allocation →", () => {
    renderWithPortfolio();
    expect(screen.getByText("Real allocation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open My allocation →" })).toHaveAttribute(
      "href",
      "/allocations",
    );
    expect(document.body.textContent).toMatch(
      /This allocation's positions, amounts, and invest\/divest events are derived automatically/,
    );
    expect(document.body.textContent).not.toMatch(/portfolio/i);
  });
});
