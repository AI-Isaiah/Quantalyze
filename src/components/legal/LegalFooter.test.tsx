/**
 * Phase 164.6.6.3.5 DOMAINONE plan 05 (AD-07) — LegalFooter reaches /contact.
 *
 * Public pages otherwise reach the contact form only from an in-page pointer,
 * so the footer carries a last `Contact` link. Five 44px-tall links no longer
 * fit one row at 390px, so the nav must wrap rather than scroll the page
 * sideways (UI-SPEC "overflow" consideration).
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LegalFooter } from "./LegalFooter";

describe("<LegalFooter>", () => {
  it("lists the five links in order with Contact last, pointing at /contact", () => {
    render(<LegalFooter />);
    const links = within(
      screen.getByRole("navigation", { name: "Legal" }),
    ).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "Security",
      "Privacy",
      "Terms",
      "Risk Disclaimer",
      "Contact",
    ]);
    expect(links[4]).toHaveAttribute("href", "/contact");
  });

  it("gives Contact the same class as its siblings, so it keeps the 44px target", () => {
    render(<LegalFooter />);
    const links = within(
      screen.getByRole("navigation", { name: "Legal" }),
    ).getAllByRole("link");
    expect(links[4].className).toBe(links[0].className);
    expect(links[4].className).toContain("min-h-[44px]");
  });

  it("wraps the nav so five links do not overflow a 390px viewport", () => {
    render(<LegalFooter />);
    expect(screen.getByRole("navigation", { name: "Legal" }).className).toContain(
      "flex-wrap",
    );
  });
});
