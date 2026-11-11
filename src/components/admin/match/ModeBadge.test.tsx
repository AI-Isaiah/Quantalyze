import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModeBadge } from "./ModeBadge";

/**
 * Phase 201 plan 20 (D-04, D-06) - the screening note names what is missing in the allocator's
 * words. WHY: "No allocation context" and "mandate fit" are the same two words the candidate
 * sub-scores print, so staff read one vocabulary on one screen.
 */
describe("ModeBadge screening note (D-04, D-06)", () => {
  it("reads 'No allocation context - score reflects mandate fit only.'", () => {
    render(<ModeBadge mode="screening" />);
    expect(
      screen.getByText("No allocation context \u2014 score reflects mandate fit only."),
    ).toBeInTheDocument();
  });

  it("personalized mode prints the badge and no note", () => {
    const { container } = render(<ModeBadge mode="personalized" />);
    expect(container.textContent).toBe("Personalized");
  });
});
