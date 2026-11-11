import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyWatchlist } from "./EmptyWatchlist";

/**
 * Phase 201 plan 17 (D-05): the empty watchlist tells the allocator what to DO with the
 * star control, and names the list the strategy is added to. A watchlisted strategy is never
 * a "favorite" or "starred". The sentence is typed by hand.
 */
describe("EmptyWatchlist", () => {
  it("reads the star instruction and names the watchlist", () => {
    render(<EmptyWatchlist />);
    expect(
      screen.getByText(
        "Use the star on a strategy in the All tab to add it to your watchlist.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Your watchlist is empty")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/favorite|starred/i);
  });
});
