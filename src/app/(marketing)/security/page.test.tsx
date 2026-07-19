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

  it("renders the banner with role='status' and warning-tinted full-border envelope", () => {
    render(<SecurityPage />);
    const banner = screen
      .getByText("SOC 2 status: pre-audit, preparing for SOC 2 Type 1.")
      .closest("[role='status']") as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.className).not.toContain("border-l-4");
    expect(banner.className).toContain("rounded-md");
    expect(banner.className).toContain("border-warning/30");
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
      // #csv-format is the most deep-linked anchor on this page — 13 wizard error
      // help links (wizardErrors.ts docsHref "/security#csv-format") scroll here.
      // If a refactor drops/renames it those links silently anchor nowhere, so it
      // belongs in the preservation pin alongside egress-ips.
      "csv-format",
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

/**
 * Phase 69 — Deribit readonly setup guide (UX-02, SC-2).
 *
 * A new #deribit-readonly SubAnchor inside the readonly-key section documents
 * how to create a read-only Deribit key. SC-2 hard requirement: the block's
 * scope checklist MUST literally name `account:read` and steer users away from
 * write grants. The steer-away assertions match on GRANTING phrasing, never on
 * the bare tokens Trade/Withdraw/:read_write — those tokens legitimately appear
 * in steer-away language here and in the sibling blocks (UI-SPEC test trap).
 *
 * Revert-proof: deleting the SubAnchor turns Test 1 red; dropping account:read
 * turns Test 2 red.
 */
describe("Phase 69 — Deribit readonly setup guide (UX-02)", () => {
  it("renders a #deribit-readonly block titled Deribit", () => {
    render(<SecurityPage />);
    const block = document.getElementById("deribit-readonly");
    expect(block).not.toBeNull();
    expect(within(block as HTMLElement).getByRole("heading")).toHaveTextContent(
      "Deribit",
    );
  });

  it("names account:read literally in the scope checklist (SC-2)", () => {
    render(<SecurityPage />);
    const block = document.getElementById("deribit-readonly") as HTMLElement;
    expect(within(block).getByText(/account:read/)).toBeInTheDocument();
  });

  it("steers away from write grants using granting phrasing (not bare tokens)", () => {
    render(<SecurityPage />);
    const block = document.getElementById("deribit-readonly") as HTMLElement;
    // Assert on GRANTING phrasing — the bare tokens Trade/Withdraw/:read_write
    // also live in steer-away language, so matching them would be a false pin.
    expect(block.textContent).toMatch(/Do not enable Trade or Withdraw/);
    expect(block.textContent).toMatch(/do not grant any :read_write scope/);
  });
});

/**
 * Phase 122 Plan 03 — sFOX readonly setup guide (SFOX-08, F3-honest).
 *
 * A new #sfox-readonly SubAnchor inside the readonly-key section documents how
 * to mint a read-only sFOX API token and whitelist the static egress IP. It is
 * the deep-link target for ConnectKeyStep's derived /security#sfox-readonly
 * href (plan 122-02 pins the link side; this plan provides the target).
 *
 * F3 honesty is the hard requirement (threat T-122-08): sFOX exposes no per-key
 * scope endpoint, so the copy must (a) instruct minting a READ-ONLY token,
 * (b) state the adapter is structurally read-only (no order/withdraw path), and
 * (c) NEVER claim a server-verified read-only scope for sfox. Threat T-122-09:
 * no hardcoded egress IP — the security@ contact channel gates disclosure,
 * mirroring the #egress-ips precedent.
 *
 * Revert-proof: deleting the SubAnchor turns the first test red; softening the
 * honest limit turns the honesty tests red; leaking a false-verified claim or a
 * hardcoded IP turns the negative tests red.
 */
describe("Phase 122 — sFOX readonly setup guide (SFOX-08, F3)", () => {
  it("renders a #sfox-readonly block titled sFOX inside the readonly-key section", () => {
    render(<SecurityPage />);
    const block = document.getElementById("sfox-readonly");
    expect(block).not.toBeNull();
    expect(within(block as HTMLElement).getByRole("heading")).toHaveTextContent(
      "sFOX",
    );
    // Nested under the readonly-key section (deribit precedent placement).
    expect(document.getElementById("readonly-key")?.contains(block)).toBe(true);
  });

  it("instructs minting a READ-ONLY single API token (F3 remedy)", () => {
    render(<SecurityPage />);
    const block = document.getElementById("sfox-readonly") as HTMLElement;
    expect(block.textContent).toMatch(/read-only/i);
    // sFOX auth is a single Bearer token — no separate secret.
    expect(block.textContent).toMatch(/single API token/i);
  });

  it("states the F3 limit: no per-key scope endpoint, structurally read-only adapter", () => {
    render(<SecurityPage />);
    const block = document.getElementById("sfox-readonly") as HTMLElement;
    // The honest limit, with the reason attached (DESIGN.md Voice).
    expect(block.textContent).toMatch(/does not expose a per-key scope endpoint/);
    expect(block.textContent).toMatch(/no order or withdraw path/i);
  });

  it("whitelists the static egress IP via the security contact — no hardcoded IP (T-122-09)", () => {
    render(<SecurityPage />);
    const block = document.getElementById("sfox-readonly") as HTMLElement;
    expect(block.textContent).toMatch(/static egress IP/i);
    // Disclosure gated by the contact channel, mirroring #egress-ips.
    const mailto = within(block).getByRole("link", {
      name: "security@quantalyze.com",
    });
    expect(mailto).toHaveAttribute("href", "mailto:security@quantalyze.com");
    // No literal IPv4/IPv6 address is baked into the copy.
    expect(block.textContent).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
    expect(block.textContent).not.toMatch(/\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){4,}\b/i);
  });

  it("makes NO false verified-scope claim for sfox (T-122-08)", () => {
    render(<SecurityPage />);
    const block = document.getElementById("sfox-readonly") as HTMLElement;
    // The non-sfox key-handling copy legitimately says keys are "rejected
    // before the ciphertext is written" / "we verify" — that claim is TRUE for
    // scope-probing exchanges but would be a LIE for sfox. Assert none of that
    // affirmative-verification phrasing leaks into the sfox block.
    expect(block.textContent).not.toMatch(/verified read-only scope/i);
    expect(block.textContent).not.toMatch(/we verify the scope/i);
    expect(block.textContent).not.toMatch(/rejected before/i);
  });
});
