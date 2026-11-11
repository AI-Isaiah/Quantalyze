import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { VerificationResults } from "./VerificationResults";
import { termDefinition } from "@/lib/glossary";

// Phase 201 plan 18 (D-02): the public landing card is a covered surface, so
// TWR and Sharpe on it are Term triggers carrying the registry definition. The
// arms fail when either label goes back to plain text, and when the definition
// is not the registry's.
const RESULTS = {
  twr: 0.123,
  sharpe: 1.4,
  trade_count: 42,
  return_ytd: 0.08,
} as unknown as Parameters<typeof VerificationResults>[0]["results"];

describe("VerificationResults: terms on the public landing card", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders TWR and Sharpe as registry terms and keeps their text", () => {
    render(<VerificationResults results={RESULTS} matchedStrategyId={null} />);
    const twr = screen.getByText("TWR");
    expect(twr).toHaveAttribute("data-term", "twr");
    expect(twr).toHaveAttribute("tabindex", "0");
    const sharpe = screen.getByText("Sharpe");
    expect(sharpe).toHaveAttribute("data-term", "sharpe");
    expect(document.querySelectorAll("[data-term]")).toHaveLength(2);
  });

  it("keyboard focus on TWR shows the registry definition", () => {
    render(<VerificationResults results={RESULTS} matchedStrategyId={null} />);
    fireEvent.focus(screen.getByText("TWR"));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByRole("tooltip").textContent).toBe(termDefinition("twr"));
  });
});
