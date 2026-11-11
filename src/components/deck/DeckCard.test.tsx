import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeckCard } from "./DeckCard";
import type { DeckWithCount } from "@/lib/types";

// Phase 201 plan 18 (D-11): the deck card's date is the one date format
// (`Oct 9, 2026`, UTC fields), not the browser locale's string.
describe("DeckCard", () => {
  it("prints its created date through formatDay", () => {
    const deck = {
      id: "d1",
      name: "Crypto trend",
      slug: "crypto-trend",
      description: null,
      created_at: "2026-10-09T23:30:00Z",
      strategy_count: 3,
    } as unknown as DeckWithCount;
    render(<DeckCard deck={deck} />);
    expect(screen.getByText("Oct 9, 2026")).toBeInTheDocument();
  });
});
