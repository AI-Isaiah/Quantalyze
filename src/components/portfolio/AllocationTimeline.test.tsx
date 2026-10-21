import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AllocationTimeline } from "./AllocationTimeline";
import type { AllocationEvent } from "@/lib/types";

// Two ids that share their first 8 characters, so a leaked id slice could not
// tell the strategies apart and an id leak is easy to pin by substring.
const ID_A = "abcdef12-0000-4000-8000-000000000001";
const ID_B = "abcdef12-0000-4000-8000-000000000002";

function event(over: Partial<AllocationEvent> = {}): AllocationEvent {
  return {
    id: "ev-1",
    portfolio_id: "pf-1",
    strategy_id: ID_A,
    event_type: "deposit",
    amount: 1000,
    event_date: "2026-03-01",
    notes: null,
    source: "manual",
    created_at: "2026-03-01T00:00:00Z",
    ...over,
  };
}

describe("<AllocationTimeline> labels", () => {
  it("a strategy with no name reads 'Unnamed strategy' and never shows its id", () => {
    const { container } = render(
      <AllocationTimeline events={[event()]} strategyNames={{}} />,
    );
    expect(screen.getByText("Unnamed strategy")).toBeInTheDocument();
    expect(container.textContent).not.toContain("abcdef12");
  });

  it("a known strategy still reads its own name", () => {
    render(
      <AllocationTimeline events={[event()]} strategyNames={{ [ID_A]: "Alpha Carry" }} />,
    );
    expect(screen.getByText("Alpha Carry")).toBeInTheDocument();
    expect(screen.queryByText("Unnamed strategy")).toBeNull();
  });

  it("event types read as words, with a fallback for an unknown type", () => {
    render(
      <AllocationTimeline
        events={[
          event({ id: "e1", event_type: "deposit" }),
          event({ id: "e2", event_type: "withdrawal" }),
          event({ id: "e3", event_type: "rebalance" as unknown as AllocationEvent["event_type"] }),
        ]}
        strategyNames={{ [ID_A]: "Alpha Carry" }}
      />,
    );
    expect(screen.getByText("Deposit")).toBeInTheDocument();
    expect(screen.getByText("Withdrawal")).toBeInTheDocument();
    expect(screen.getByText("Other event")).toBeInTheDocument();
    expect(screen.queryByText("deposit")).toBeNull();
    expect(screen.queryByText("withdrawal")).toBeNull();
  });

  it("zero-one-many: two unnamed strategies render two separate 'Unnamed strategy' rows", () => {
    render(
      <AllocationTimeline
        events={[
          event({ id: "e1", strategy_id: ID_A }),
          event({ id: "e2", strategy_id: ID_B }),
        ]}
        strategyNames={{}}
      />,
    );
    expect(screen.getAllByText("Unnamed strategy")).toHaveLength(2);
  });
});
