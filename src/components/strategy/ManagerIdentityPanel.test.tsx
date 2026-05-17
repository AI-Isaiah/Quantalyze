/**
 * Regression tests for the ManagerIdentityPanel LinkedIn XSS sink
 * (audit-2026-05-07 red-team HIGH conf 8, fingerprint
 * src/components/strategy/ManagerIdentityPanel.tsx:86:red-team).
 *
 * The `profiles.linkedin` column is plain TEXT with no CHECK constraint,
 * and ProfileForm writes raw `<Input>` text straight to Supabase, so a
 * compromised or malicious manager account can store a `javascript:` URI.
 * The C-0189 closure makes the institutional panel render for every
 * attested viewer of a PUBLIC_ROUTES tearsheet URL — so the XSS sink fires
 * on every click of "LinkedIn profile →" by an attested allocator.
 * `rel="noopener noreferrer"` blocks `window.opener` leaks but NOT
 * `javascript:` execution.
 *
 * Post-fix, only http(s) URLs survive the `safeLinkedinHref` filter; every
 * other scheme (javascript:, data:, vbscript:, file:, anything that
 * doesn't parse as a URL) renders no anchor at all.
 *
 * These tests pin the load-bearing assertion: a `javascript:` linkedin
 * value MUST NOT produce a clickable anchor. A regression that removed
 * the scheme check would let `screen.getByRole("link", {name: /LinkedIn/})`
 * succeed with a `javascript:` href and the assertion below would flip.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ManagerIdentityPanel } from "./ManagerIdentityPanel";
import type { ManagerIdentity } from "@/lib/types";

function baseManager(overrides: Partial<ManagerIdentity> = {}): ManagerIdentity {
  return {
    display_name: "Jane Doe",
    company: "Doe Capital",
    bio: "A bio.",
    years_trading: 10,
    aum_range: "$10M-$50M",
    linkedin: null,
    ...overrides,
  };
}

describe("ManagerIdentityPanel — linkedin XSS guard", () => {
  it("renders an https://… linkedin URL as an anchor", () => {
    render(
      <ManagerIdentityPanel
        disclosureTier="institutional"
        manager={baseManager({ linkedin: "https://linkedin.com/in/jane-doe" })}
        strategyCodename="STRAT-001"
      />,
    );
    const link = screen.getByRole("link", { name: /LinkedIn profile/i });
    expect(link).toHaveAttribute("href", "https://linkedin.com/in/jane-doe");
  });

  it("accepts http://… (allowlist is http + https)", () => {
    render(
      <ManagerIdentityPanel
        disclosureTier="institutional"
        manager={baseManager({ linkedin: "http://linkedin.com/in/jane-doe" })}
        strategyCodename="STRAT-001"
      />,
    );
    expect(
      screen.getByRole("link", { name: /LinkedIn profile/i }),
    ).toHaveAttribute("href", "http://linkedin.com/in/jane-doe");
  });

  it("DROPS a javascript: URI — no anchor rendered (the load-bearing assertion)", () => {
    render(
      <ManagerIdentityPanel
        disclosureTier="institutional"
        manager={baseManager({
          linkedin: 'javascript:fetch("/api/keys?exfil="+document.cookie)',
        })}
        strategyCodename="STRAT-001"
      />,
    );
    // No anchor at all — the panel renders, but the LinkedIn row is gone.
    expect(screen.queryByRole("link", { name: /LinkedIn profile/i })).toBeNull();
    expect(screen.queryByText(/LinkedIn profile/i)).toBeNull();
    // Sanity: the rest of the institutional identity still renders.
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("DROPS a data: URI", () => {
    render(
      <ManagerIdentityPanel
        disclosureTier="institutional"
        manager={baseManager({
          linkedin: "data:text/html,<script>alert(1)</script>",
        })}
        strategyCodename="STRAT-001"
      />,
    );
    expect(screen.queryByRole("link", { name: /LinkedIn profile/i })).toBeNull();
  });

  it("DROPS a vbscript: URI", () => {
    render(
      <ManagerIdentityPanel
        disclosureTier="institutional"
        manager={baseManager({ linkedin: "vbscript:msgbox(1)" })}
        strategyCodename="STRAT-001"
      />,
    );
    expect(screen.queryByRole("link", { name: /LinkedIn profile/i })).toBeNull();
  });

  it("DROPS a malformed / unparseable value", () => {
    render(
      <ManagerIdentityPanel
        disclosureTier="institutional"
        manager={baseManager({ linkedin: "not a url at all" })}
        strategyCodename="STRAT-001"
      />,
    );
    expect(screen.queryByRole("link", { name: /LinkedIn profile/i })).toBeNull();
  });

  it("DROPS an empty / null linkedin", () => {
    render(
      <ManagerIdentityPanel
        disclosureTier="institutional"
        manager={baseManager({ linkedin: "" })}
        strategyCodename="STRAT-001"
      />,
    );
    expect(screen.queryByRole("link", { name: /LinkedIn profile/i })).toBeNull();
  });

  it("renders nothing for exploratory tier even with a valid https URL", () => {
    // The disclosure-tier gate is the outer wall — the linkedin guard is a
    // defense-in-depth backstop inside the institutional branch only.
    render(
      <ManagerIdentityPanel
        disclosureTier="exploratory"
        manager={baseManager({ linkedin: "https://linkedin.com/in/jane-doe" })}
        strategyCodename="STRAT-001"
      />,
    );
    expect(screen.queryByRole("link", { name: /LinkedIn profile/i })).toBeNull();
    expect(screen.getByText(/Pseudonymous strategy/i)).toBeInTheDocument();
  });
});
