/**
 * Phase 11 Plan 06 / S7 — WizardIpAllowlistHint component tests; sentence and
 * link reworked by Phase 201 PLAINWORDS plan 32 (F-12, UI-SPEC 8.2, U-28).
 * Plan 05's D-13 version (contact-form pointer, no egress link) is replaced.
 *
 * Locked contract:
 *   - The hint reads: "Locking your exchange key to an IP allowlist? Check our
 *     egress IP status first." Its one link is the phrase `egress IP status`,
 *     to `/security#egress-ips` (hand-typed here), in a new tab, with the
 *     reverse-tabnabbing `rel` pair and the one link style (F-12).
 *   - The hint carries no contact-form link and shows no raw path.
 *   - Composes from <WarningBanner> with same className override as S5
 *   - role="note" (NOT role="alert") with aria-label "Exchange IP allowlist hint"
 *   - NO dismiss control — strip is persistent across all wizard steps
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WizardIpAllowlistHint } from "./WizardIpAllowlistHint";

describe("WizardIpAllowlistHint (S7 / F-12)", () => {
  it("renders the UI-SPEC sentence, with the new-tab suffix only for assistive tech", () => {
    render(<WizardIpAllowlistHint />);
    const note = screen.getByRole("note");
    expect(note.textContent).toBe(
      "Locking your exchange key to an IP allowlist? Check our egress IP status (opens in a new tab) first.",
    );
  });

  it("has exactly one link, 'egress IP status', to the egress anchor in a new tab (F-12)", () => {
    render(<WizardIpAllowlistHint />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    // The suffix is a leading-space sr-only span; jsdom's name computation drops
    // that space, a browser keeps it, so the name is matched either way.
    const link = screen.getByRole("link", {
      name: /^egress IP status\s?\(opens in a new tab\)$/,
    });
    expect(link).toHaveAttribute("href", "/security#egress-ips");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.className).toContain("text-accent underline underline-offset-4");
  });

  it("links nowhere to the contact form and shows no raw path (F-12)", () => {
    render(<WizardIpAllowlistHint />);
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((h) => h.startsWith("/contact"))).toEqual([]);
    expect(screen.getByRole("note").textContent).not.toContain("/security");
  });

  it("composes from <WarningBanner> with locked className override", () => {
    const { container } = render(<WizardIpAllowlistHint />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.className).not.toContain("border-l-4");
    expect(root.className).toContain("rounded-md");
    expect(root.className).toContain("border-warning/30");
    expect(root.className).toContain("bg-warning/5");
  });

  it("uses role='note' with aria-label='Exchange IP allowlist hint'", () => {
    render(<WizardIpAllowlistHint />);
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("aria-label", "Exchange IP allowlist hint");
  });

  it("renders no dismiss button (persistent strip)", () => {
    render(<WizardIpAllowlistHint />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("applies mt-2 spacing so it sits 8px below the WithdrawalWarningStrip", () => {
    const { container } = render(<WizardIpAllowlistHint />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("mt-2");
  });
});
