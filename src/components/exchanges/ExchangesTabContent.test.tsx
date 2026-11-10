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

const ALLOCATOR_INTRO = /build your Active Allocation portfolio/;

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
