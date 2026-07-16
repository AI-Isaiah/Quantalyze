/**
 * Phase 11 Plan 06 / S7 / D-07 — WizardIpAllowlistHint component tests.
 *
 * Locked contract:
 *   - Verbatim D-07 sentence (byte-for-byte): "Locking your exchange key
 *     to an IP allowlist? Allow our egress IPs — see /security#egress-ips."
 *   - The "/security#egress-ips" token renders as <a href="/security#egress-ips">
 *     with visible text byte-identical to "/security#egress-ips"
 *   - Composes from <WarningBanner> with same className override as S5
 *   - role="note" (NOT role="alert") with aria-label "Exchange IP allowlist hint"
 *   - NO dismiss control — strip is persistent across all wizard steps
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WizardIpAllowlistHint } from "./WizardIpAllowlistHint";

describe("WizardIpAllowlistHint (S7 / D-07)", () => {
  it("renders the verbatim D-07 sentence", () => {
    render(<WizardIpAllowlistHint />);
    const note = screen.getByRole("note");
    // Whitespace can collapse around the inline link; assert the textContent
    // flows continuously across the JSX whitespace boundary.
    expect(note.textContent).toMatch(
      /Locking your exchange key to an IP allowlist\? Allow our egress IPs — see \s*\/security#egress-ips\s*\./,
    );
  });

  it("renders /security#egress-ips as an anchor with byte-identical visible text", () => {
    render(<WizardIpAllowlistHint />);
    const link = screen.getByRole("link", { name: "/security#egress-ips" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/security#egress-ips");
    expect(link.className).toContain("text-accent");
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
