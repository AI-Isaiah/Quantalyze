/**
 * Phase 11 Plan 06 — `/security` editorial-patch assertions.
 *
 * Covers the surgical edits this plan ships on the public security page:
 *   - S4a (D-06) SOC-2 status banner inside the Compliance Posture section
 *   - S4c (D-05) public audit-log link line inside the Data-handling-summary section
 *
 * S4b (inline egress-IP block per D-07) is DEFERRED in this plan because the
 * analytics-service does not currently advertise static egress IPs. The
 * contact-form path ("Use the contact form for the current IP set", Phase
 * 164.6.6.3.5 DOMAINONE S6) is the disclosure channel; the assertions below
 * confirm the deferral state.
 *
 * Anchor-ID preservation: every `<section aria-labelledby="…">` ID and the
 * `Section id="…"` rendered subsection ID must stay byte-identical because
 * wizard error `docsHref` deep-links and the new S7 wizard hint land on
 * `/security#egress-ips`.
 *
 * Public + indexable: `metadata.robots.index === true` is locked by
 * UI-SPEC AC #10 — `/security` is unauthenticated and meant to be crawled.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SecurityPage, { metadata } from "./page";
import { contactHref } from "@/lib/contact";

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
    // fragment ends with an em-dash before the inline contact link.
    expect(
      within(compliance).getByText(/Allocators evaluating us under diligence —/),
    ).toBeInTheDocument();
  });

  it("links 'request a posture letter' to the security contact form (D-01, S6)", () => {
    render(<SecurityPage />);
    const link = screen.getByRole("link", { name: "request a posture letter" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", contactHref({ topic: "security" }));
    expect(link.className).toContain("text-accent");
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
  it("keeps the contact-form path body in the #egress-ips section", () => {
    render(<SecurityPage />);
    // S4b deferral: Plan 11-06 originally specified an inline IP block per
    // D-07. The analytics-service doesn't advertise static egress IPs yet,
    // so "Use the contact form for the current IP set" remains the canonical
    // disclosure path (the mail address it replaced is retired, D-01).
    // Re-evaluate post static-IP infrastructure work.
    const section = document.getElementById("egress-ips") as HTMLElement;
    expect(section).toBeTruthy();
    expect(section.textContent).toMatch(
      /Use the contact form for the current IP set/,
    );
    expect(section.textContent).toMatch(/rotate infrequently/);
    expect(section.textContent).not.toMatch(/Email/);
    expect(
      within(section).getByRole("link", { name: "contact form" }),
    ).toHaveAttribute("href", contactHref({ topic: "security" }));
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
 * no hardcoded egress IP — the security contact form gates disclosure,
 * mirroring the #egress-ips precedent.
 *
 * Revert-proof: deleting the SubAnchor turns the first test red; softening the
 * honest limit turns the honesty tests red; leaking a false-verified claim or a
 * hardcoded IP turns the negative tests red.
 */
describe("Phase 122 — sFOX readonly setup guide (SFOX-08, F3)", () => {
  // F2/F1 (Phase 122): the guide is founder-gated. It renders ONLY when the
  // server go-live flag SFOX_ENABLED is on; the ENABLED assertions below pin it
  // on, and the dedicated fail-closed block further down proves it is ABSENT
  // (byte-identical to the pre-sfox page) when the flag is off.
  beforeEach(() => {
    process.env.SFOX_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.SFOX_ENABLED;
  });

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
    expect(block.textContent).toMatch(/Use the contact form for the current IP/);
    // Disclosure gated by the contact channel, mirroring #egress-ips.
    const contact = within(block).getByRole("link", { name: "contact form" });
    expect(contact).toHaveAttribute("href", contactHref({ topic: "security" }));
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

/**
 * F1 (Phase 122 — pre-launch leak removal): with SFOX_ENABLED off (the default),
 * the /security#sfox-readonly guide must be ABSENT. Pre-launch there is no sfox
 * wizard card to "paste into" and no static egress IP to whitelist, so rendering
 * the guide would assert a capability we do not have yet. Absence also keeps the
 * public page byte-identical to its pre-sfox baseline while the flag is off.
 */
describe("Phase 122 — sFOX guide is founder-gated (F1, SFOX_ENABLED off)", () => {
  beforeEach(() => {
    delete process.env.SFOX_ENABLED;
  });

  it("does NOT render the #sfox-readonly block when the server flag is off", () => {
    render(<SecurityPage />);
    expect(document.getElementById("sfox-readonly")).toBeNull();
  });

  it("does not leak the false static-egress-IP copy pre-launch", () => {
    render(<SecurityPage />);
    // The sfox-only "whitelist our static egress IP … paste the token into the
    // wizard" copy lives ONLY in the gated SubAnchor; the #egress-ips section's
    // generic contact-form copy is unaffected. With the flag off, the sfox phrasing
    // must be gone from the whole page.
    expect(document.body.textContent).not.toMatch(/paste the token into the wizard/i);
    expect(document.body.textContent).not.toMatch(/single API token/i);
  });

  it.each(["1", "on", "", "false"])(
    "stays absent for a non-exact SFOX_ENABLED=%s (strict 'true' only)",
    (flag) => {
      process.env.SFOX_ENABLED = flag;
      render(<SecurityPage />);
      expect(document.getElementById("sfox-readonly")).toBeNull();
      delete process.env.SFOX_ENABLED;
    },
  );

  it("still renders the sibling #deribit-readonly and #egress-ips (only sfox is gated)", () => {
    render(<SecurityPage />);
    expect(document.getElementById("deribit-readonly")).not.toBeNull();
    expect(document.getElementById("egress-ips")).not.toBeNull();
  });
});

/**
 * Phase 138 Plan 02 — MT5 investor-password setup guide (MT5UI-01).
 *
 * A new #mt5-readonly SubAnchor inside the readonly-key section documents how to
 * connect with an MT5 investor (read-only) password and how to copy the exact
 * broker server string. It is the deep-link target for the wizard's derived
 * /security#mt5-readonly href (plan 138-01 pins the link side; this plan provides
 * the target).
 *
 * Gating (threat T-138-05/07): founder-gated on the SERVER flag MT5_ENABLED
 * (isMt5EnabledServer) — the same seam sfox uses — never the client
 * NEXT_PUBLIC_MT5_ENABLED. Pre-launch there is no MT5 wizard card to point at, so
 * the block must be ABSENT and the page byte-identical to its pre-mt5 baseline.
 *
 * Honesty (threat T-138-06): the copy is constrained to server-enforced facts —
 * the investor login is read-only and a master password is refused at connect
 * time with nothing stored (the 135 KEY_MT5_MASTER_PASSWORD contract). No IP /
 * gateway / hosting claim (that surface is Phase 139 founder ops, not yet real) —
 * the negative IP regexes pin its absence.
 *
 * Revert-proof: deleting the SubAnchor turns the first test red; dropping the
 * investor/master steer or the refusal-honesty phrase turns the content tests
 * red; leaking a literal IP turns the negative test red; gating on the client
 * flag (which is undefined in this Server Component) would make the ON block fail.
 */
describe("Phase 138 — MT5 readonly setup guide (MT5UI-01)", () => {
  beforeEach(() => {
    process.env.MT5_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.MT5_ENABLED;
  });

  it("renders a #mt5-readonly block titled MT5 inside the readonly-key section", () => {
    render(<SecurityPage />);
    const block = document.getElementById("mt5-readonly");
    expect(block).not.toBeNull();
    expect(within(block as HTMLElement).getByRole("heading")).toHaveTextContent(
      "MT5",
    );
    // Nested under the readonly-key section (deribit/sfox precedent placement).
    expect(document.getElementById("readonly-key")?.contains(block)).toBe(true);
  });

  it("steers to the INVESTOR password, never the MASTER password", () => {
    render(<SecurityPage />);
    const block = document.getElementById("mt5-readonly") as HTMLElement;
    expect(block.textContent).toMatch(/investor/i);
    expect(block.textContent).toMatch(/master password/i);
  });

  it("honestly states a master password is refused with nothing stored (135 contract)", () => {
    render(<SecurityPage />);
    const block = document.getElementById("mt5-readonly") as HTMLElement;
    // Agrees with KEY_MT5_MASTER_PASSWORD honesty: refused at connect, nothing stored.
    expect(block.textContent).toMatch(/refuse/i);
    expect(block.textContent).toMatch(/store nothing/i);
  });

  it("tells the user to copy the broker server string exactly (region / Demo-Live caveat)", () => {
    render(<SecurityPage />);
    const block = document.getElementById("mt5-readonly") as HTMLElement;
    expect(block.textContent).toMatch(/server name/i);
    expect(block.textContent).toMatch(/exactly/i);
    // Agrees with KEY_MT5_WRONG_SERVER fix copy — region / Demo/Live suffix caveat.
    expect(block.textContent).toMatch(/Demo\/Live|region/i);
  });

  it("makes NO infrastructure claim — no literal IP baked in (T-138-06)", () => {
    render(<SecurityPage />);
    const block = document.getElementById("mt5-readonly") as HTMLElement;
    // The gateway/egress/hosting story is Phase 139 founder ops; the guide must
    // not assert infrastructure that does not exist yet.
    expect(block.textContent).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
    expect(block.textContent).not.toMatch(/\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){4,}\b/i);
    expect(block.textContent).not.toMatch(/whitelist|egress|gateway/i);
  });
});

/**
 * Phase 138 (pre-launch leak removal): with MT5_ENABLED off (the default), the
 * /security#mt5-readonly guide must be ABSENT. Pre-launch there is no MT5 wizard
 * card to point at, so rendering the guide would advertise an unavailable
 * capability (and coach users into a fail-closed connect). Absence keeps the
 * public page byte-identical to its pre-mt5 baseline while the flag is off.
 */
describe("Phase 138 — MT5 guide is founder-gated (MT5_ENABLED off)", () => {
  beforeEach(() => {
    delete process.env.MT5_ENABLED;
  });

  it("does NOT render the #mt5-readonly block when the server flag is off", () => {
    render(<SecurityPage />);
    expect(document.getElementById("mt5-readonly")).toBeNull();
  });

  it.each(["1", "on", "", "false", "TRUE"])(
    "stays absent for a non-exact MT5_ENABLED=%s (strict 'true' only)",
    (flag) => {
      process.env.MT5_ENABLED = flag;
      render(<SecurityPage />);
      expect(document.getElementById("mt5-readonly")).toBeNull();
      delete process.env.MT5_ENABLED;
    },
  );

  it("still renders the sibling #deribit-readonly (only mt5 is gated here)", () => {
    render(<SecurityPage />);
    expect(document.getElementById("deribit-readonly")).not.toBeNull();
  });

  it("keeps the sfox block gated by ITS own flag (SFOX_ENABLED unset → absent)", () => {
    // The mt5 gate must not accidentally un-gate sfox; with SFOX_ENABLED unset
    // the sfox block stays absent regardless of MT5_ENABLED state.
    delete process.env.SFOX_ENABLED;
    render(<SecurityPage />);
    expect(document.getElementById("sfox-readonly")).toBeNull();
  });
});

/**
 * Phase 164.6.6.3.5 DOMAINONE (D-01, UI-SPEC S6) — the page names no mailbox.
 *
 * Every former address mention (posture-letter banner, Security contact
 * section, sFOX step, #egress-ips, #sync-timing) is now a link to
 * `/contact?topic=security`, and nothing on the page renders an `@` or a
 * mail-scheme link. A researcher or allocator reading this page must land on
 * the form that writes to the founder CRM, not on a mailbox nobody reads.
 *
 * Fails when: any mail-scheme href returns, an `@` appears in rendered text,
 * the Security contact section drifts from the UI-SPEC sentence, or a pointer
 * link loses the page's link class (UI-SPEC Color: one link style).
 */
describe("Phase 164.6.6.3.5 — /security names no address (D-01, S6)", () => {
  const SECURITY_HREF = contactHref({ topic: "security" });

  beforeEach(() => {
    process.env.SFOX_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.SFOX_ENABLED;
  });

  it("renders no mail-scheme link and no @ in the text", () => {
    const { container } = render(<SecurityPage />);
    // Scheme assembled so no literal mail link sits in this file (the plan's
    // negative grep reads the file text).
    const scheme = ["mail", "to:"].join("");
    expect(container.querySelector(`a[href^="${scheme}"]`)).toBeNull();
    expect(document.body.textContent).not.toContain("@");
  });

  it("the Security contact section reads the UI-SPEC sentence and links the form", () => {
    render(<SecurityPage />);
    const section = document.getElementById("security-contact")
      ?.parentElement as HTMLElement;
    expect(section).toBeTruthy();
    expect(section.textContent).toContain(
      "Allocators asking for a posture letter, researchers reporting a vulnerability, and anyone with a concrete security question should use the contact form and choose Security report. We reply within one business day. Acknowledgments for coordinated disclosure are published on this page.",
    );
    const link = within(section).getByRole("link", { name: "contact form" });
    expect(link).toHaveAttribute("href", SECURITY_HREF);
    expect(link.className).toContain("text-accent underline underline-offset-4");
  });

  it("#sync-timing ends its sentence with 'when to use the contact form.'", () => {
    render(<SecurityPage />);
    const section = document.getElementById("sync-timing") as HTMLElement;
    expect(section.textContent).toContain("when to use the contact form.");
    expect(
      within(section).getByRole("link", { name: "contact form" }),
    ).toHaveAttribute("href", SECURITY_HREF);
  });

  it("every contact link on the page goes to the security topic with the page's link class", () => {
    render(<SecurityPage />);
    const links = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/contact"));
    // posture letter, Security contact section, sFOX step, #egress-ips, #sync-timing
    expect(links).toHaveLength(5);
    for (const a of links) {
      expect(a).toHaveAttribute("href", SECURITY_HREF);
      expect(a.className).toContain("text-accent underline underline-offset-4");
    }
  });
});
