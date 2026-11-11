/**
 * Phase 164.6.6.3.5 DOMAINONE plan 06 — ContactPointerText.
 *
 * The one renderer behind every "use the contact form" pointer (AD-05). The
 * contract each case guards:
 *   - the FIRST occurrence of CONTACT_FORM_LINK_TEXT becomes a link to `href`;
 *   - a string without the phrase is returned untouched (a copy constant that a
 *     sibling plan has not rewritten yet must not break);
 *   - `newTab` is what keeps a user's unsaved wizard / dialog state alive (AD-04),
 *     and its `rel` is the reverse-tabnabbing mitigation (T-164.6.6.3.5-20);
 *   - server-supplied text is rendered as text nodes, never markup (T-...-19);
 *   - plan 201-32 (F-12, U-28): an optional `linkText` links another phrase
 *     (the egress pair) through the same classes, `rel` and suffix; without it
 *     the component links `contact form` exactly as before.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ContactPointerText } from "./ContactPointerText";
import {
  CONTACT_FORM_LINK_TEXT,
  EGRESS_IP_STATUS_LINK,
  contactHref,
} from "@/lib/contact";

const HREF = contactHref({ topic: "support" });
const SENTENCE =
  "If it keeps failing, send the correlation id below through the contact form.";

describe("ContactPointerText", () => {
  it("links exactly the phrase and keeps the text order", () => {
    const { container } = render(
      <ContactPointerText text={SENTENCE} href={HREF} />,
    );
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe(CONTACT_FORM_LINK_TEXT);
    expect(links[0].getAttribute("href")).toBe(HREF);
    expect(container.textContent).toBe(SENTENCE);
  });

  it("uses the shared link class and opens in the same tab by default", () => {
    render(<ContactPointerText text={SENTENCE} href={HREF} />);
    const link = screen.getByRole("link", { name: CONTACT_FORM_LINK_TEXT });
    expect(link.className).toContain("text-accent");
    expect(link.className).toContain("underline");
    expect(link.className).toContain("underline-offset-4");
    expect(link).not.toHaveAttribute("target");
    expect(link).not.toHaveAttribute("rel");
    expect(link.textContent).not.toContain("opens in a new tab");
  });

  it("links only the first of two occurrences", () => {
    const text = "Use the contact form, or the contact form again.";
    const { container } = render(<ContactPointerText text={text} href={HREF} />);
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.textContent).toBe(text);
    // The link is the FIRST occurrence: what precedes it is the lead-in only.
    const link = container.querySelector("a")!;
    expect(link.previousSibling?.textContent).toBe("Use the ");
    expect(link.nextSibling?.textContent).toBe(", or the contact form again.");
  });

  it("renders a string without the phrase unchanged, with no link", () => {
    const text = "Something went wrong. Try again.";
    const { container } = render(<ContactPointerText text={text} href={HREF} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe(text);
  });

  it("newTab adds target, rel and the visually hidden announcement", () => {
    render(<ContactPointerText text={SENTENCE} href={HREF} newTab />);
    // dom-accessibility-api trims each child's text when it computes a name, so
    // the space before "(opens" is lost in jsdom only; a browser concatenates
    // the DOM text, which is asserted exactly via textContent below.
    const link = screen.getByRole("link", {
      name: /^contact form ?\(opens in a new tab\)$/,
    });
    expect(link.textContent).toBe(`${CONTACT_FORM_LINK_TEXT} (opens in a new tab)`);
    expect(link).toHaveAttribute("target", "_blank");
    // Reverse tabnabbing (T-164.6.6.3.5-20): BOTH tokens, every time.
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    const hidden = link.querySelector(".sr-only");
    expect(hidden).not.toBeNull();
    expect(hidden!.textContent).toBe(" (opens in a new tab)");
  });

  it("linkText links that phrase instead, with the same class, rel and suffix (F-12, U-28)", () => {
    const text = "Check our egress IP status first, or use the contact form.";
    const { container } = render(
      <ContactPointerText
        text={text}
        href={EGRESS_IP_STATUS_LINK.href}
        linkText={EGRESS_IP_STATUS_LINK.text}
        newTab
      />,
    );
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/security#egress-ips");
    expect(links[0].textContent).toBe("egress IP status (opens in a new tab)");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[0].className).toContain("text-accent underline underline-offset-4");
    // The contact-form phrase in the same text is left as plain text.
    expect(container.textContent).toBe(
      "Check our egress IP status (opens in a new tab) first, or use the contact form.",
    );
  });

  it("without linkText it still links 'contact form' and ignores the egress phrase", () => {
    const text = "Check our egress IP status first, or use the contact form.";
    const { container } = render(<ContactPointerText text={text} href={HREF} />);
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe(CONTACT_FORM_LINK_TEXT);
    expect(links[0].getAttribute("href")).toBe(HREF);
  });

  it("a text with neither phrase renders as plain text even with linkText set", () => {
    const text = "Something went wrong. Try again.";
    const { container } = render(
      <ContactPointerText
        text={text}
        href={EGRESS_IP_STATUS_LINK.href}
        linkText={EGRESS_IP_STATUS_LINK.text}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe(text);
  });

  it("renders server text as text nodes, never as markup", () => {
    const text = 'Use the contact form <img src=x onerror="alert(1)"> now';
    const { container } = render(<ContactPointerText text={text} href={HREF} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe(text);
  });
});
