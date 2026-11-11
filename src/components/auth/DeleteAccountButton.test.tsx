import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeleteAccountButton } from "./DeleteAccountButton";

// Phase 201 plan 18 (D-05, U-25): the confirmation names what the request removes
// with the canonical words, an allocation and scenarios, never "portfolios".
describe("DeleteAccountButton confirmation copy", () => {
  it("lists the allocation and scenarios, not portfolios", () => {
    render(<DeleteAccountButton />);
    fireEvent.click(screen.getByRole("button", { name: "Request account deletion" }));
    expect(
      screen.getByText(
        /Your profile, strategies, allocation, scenarios, and historical match data will be removed\. Confirm to submit the request\./,
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/portfolio/i);
  });
});
