/**
 * Phase 11 Plan 06 — `/security` editorial-patch assertions.
 *
 * Covers the surgical edits this plan ships on the public security page:
 *   - S4a (D-06) SOC-2 status banner inside the Compliance Posture section
 *   - S4c (D-05) public audit-log link line inside the Data-handling-summary section
 *
 * S4b (inline egress-IP block per D-07) is DEFERRED in this plan because the
 * analytics-service does not currently advertise static egress IPs. The
 * existing "Email security@quantalyze.com for the current IP set" body is
 * preserved unchanged; the assertions below confirm the deferral state.
 *
 * Anchor-ID preservation: every `<section aria-labelledby="…">` ID and the
 * `Section id="…"` rendered subsection ID must stay byte-identical because
 * wizard error `docsHref` deep-links and the new S7 wizard hint land on
 * `/security#egress-ips`.
 *
 * Public + indexable: `metadata.robots.index === true` is locked by
 * UI-SPEC AC #10 — `/security` is unauthenticated and meant to be crawled.
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SecurityPage, { metadata } from "./page";

describe("Phase 11 / S4a — D-06 SOC-2 status banner", () => {
  it("renders the verbatim SOC-2 banner copy inside the Compliance Posture section", () => {
    render(<SecurityPage />);
    const compliance = document.getElementById("compliance-posture")
      ?.parentElement as HTMLElement;
    expect(compliance).toBeTruthy();
    // The banner copy is split across two <span>s ("SOC 2 status: …" and
    // "Allocators evaluating …") — assert both fragments verbatim.
    expect(
      within(compliance).getByText(
        "SOC 2 status: pre-audit, preparing for SOC 2 Type 1.",
      ),
    ).toBeInTheDocument();
    // Disambiguate from the existing "Allocators evaluating us under
    // diligence should engage our security contact for a current posture
    // letter under NDA" paragraph that lives below the banner — the banner
    // fragment ends with an em-dash before the inline mailto link.
    expect(
      within(compliance).getByText(/Allocators evaluating us under diligence —/),
    ).toBeInTheDocument();
  });

  it("renders a mailto: link with visible text 'request a posture letter'", () => {
    render(<SecurityPage />);
    const link = screen.getByRole("link", { name: "request a posture letter" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      "mailto:security@quantalyze.com?subject=Posture%20letter%20request",
    );
  });

  it("renders the banner with role='status' and warning-tinted left rule", () => {
    render(<SecurityPage />);
    const banner = screen
      .getByText("SOC 2 status: pre-audit, preparing for SOC 2 Type 1.")
      .closest("[role='status']") as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.className).toContain("border-l-4");
    expect(banner.className).toContain("border-warning");
    expect(banner.className).toContain("bg-warning/5");
  });
});

describe("Phase 11 / S4b — DEFERRED (egress-IP body unchanged)", () => {
  it("preserves the existing email-path body in the #egress-ips section", () => {
    render(<SecurityPage />);
    // S4b deferral: Plan 11-06 originally specified an inline IP block per
    // D-07. The analytics-service doesn't advertise static egress IPs yet,
    // so the existing "Email security@quantalyze.com for the current IP
    // set" body remains the canonical disclosure path. Re-evaluate post
    // static-IP infrastructure work.
    const section = document.getElementById("egress-ips") as HTMLElement;
    expect(section).toBeTruthy();
    expect(section.textContent).toMatch(/Email/);
    expect(section.textContent).toMatch(/for the current IP set/);
    expect(section.textContent).toMatch(/rotate infrequently/);
  });
});

describe("Phase 11 / S4c — D-05 public audit-log link line", () => {
  it("renders the verbatim audit-log link line inside #data-handling-summary", () => {
    render(<SecurityPage />);
    const summary = document.getElementById("data-handling-summary")
      ?.parentElement as HTMLElement;
    expect(summary).toBeTruthy();
    // Verbatim copy from CONTEXT D-05 / UI-SPEC §S4c.
    expect(
      within(summary).getByText(/If you have an account, you can/),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText(/from your profile\./),
    ).toBeInTheDocument();
  });

  it("renders the inline anchor 'download your audit log' pointing at /profile?tab=security", () => {
    render(<SecurityPage />);
    const link = screen.getByRole("link", { name: "download your audit log" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/profile?tab=security");
    expect(link.className).toContain("text-accent");
  });
});

describe("Phase 11 / S4 — anchor IDs preserved (UI-SPEC AC #9)", () => {
  it("renders every existing /security anchor ID byte-identically", () => {
    render(<SecurityPage />);
    const expected = [
      "data-handling",
      "key-handling",
      "compliance-posture",
      "data-handling-summary",
      "breach-notification",
      "security-contact",
      "operational-reference",
      "egress-ips",
    ];
    for (const id of expected) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });
});

describe("Phase 11 / S4 — page is still public + indexable (UI-SPEC AC #10)", () => {
  it("metadata.robots is configured to index + follow", () => {
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });
});
