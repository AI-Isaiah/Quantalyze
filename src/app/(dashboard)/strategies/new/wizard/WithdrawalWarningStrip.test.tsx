/**
 * Phase 11 Plan 06 / S5 / D-08 — WithdrawalWarningStrip component tests.
 *
 * Locked contract:
 *   - Verbatim D-08 sentence (byte-for-byte): "READ ONLY ONLY — keys with
 *     Trade or Withdraw permissions are refused on submission."
 *   - Composes from <WarningBanner> with full-border envelope className override
 *     "rounded-md border border-warning/30 bg-warning/5"
 *   - role="note" (NOT role="alert") with aria-label
 *     "Wizard read-only key requirement"
 *   - NO dismiss control — strip is persistent across all wizard steps
 *   - Optional helper line beneath body confirms server-side enforcement
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WithdrawalWarningStrip } from "./WithdrawalWarningStrip";

describe("WithdrawalWarningStrip (S5 / D-08)", () => {
  it("renders the verbatim D-08 sentence", () => {
    render(<WithdrawalWarningStrip />);
    // The leading "READ ONLY" word is rendered semibold inside the same
    // sentence — assert the full sentence flows continuously by checking
    // the strip's combined textContent.
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(
      /READ ONLY ONLY — keys with Trade or Withdraw permissions are refused on submission\./,
    );
  });

  it("emphasises the leading 'READ ONLY' span as semibold + text-text-primary", () => {
    render(<WithdrawalWarningStrip />);
    const lead = screen.getByText("READ ONLY", { selector: "span" });
    expect(lead.className).toContain("font-semibold");
    expect(lead.className).toContain("text-text-primary");
  });

  it("composes from <WarningBanner> with locked className override", () => {
    const { container } = render(<WithdrawalWarningStrip />);
    // The outermost element is the WarningBanner's div; assert the locked
    // className tokens are present (UI-SPEC §S5 + AC #14 LOCKED).
    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.className).not.toContain("border-l-4");
    expect(root.className).toContain("rounded-md");
    expect(root.className).toContain("border-warning/30");
    expect(root.className).toContain("bg-warning/5");
  });

  it("uses role='note' with aria-label='Wizard read-only key requirement'", () => {
    render(<WithdrawalWarningStrip />);
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("aria-label", "Wizard read-only key requirement");
  });

  it("renders no dismiss button (persistent strip)", () => {
    render(<WithdrawalWarningStrip />);
    // The strip has no interactive controls. The only interactive element
    // would be a button (dismiss) — there should be none.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the helper caption confirming server-side enforcement", () => {
    render(<WithdrawalWarningStrip />);
    expect(
      screen.getByText(
        /Read-only is enforced server-side at validation — Trade\/Withdraw scopes are rejected before encryption\./,
      ),
    ).toBeInTheDocument();
  });
});
