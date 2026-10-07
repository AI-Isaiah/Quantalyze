/**
 * Phase 164.6.6.3.5 DOMAINONE plan 05 — the /contact page.
 *
 * The page is the one destination of every pointer (D-01), so the cases guard
 * what a pointer's query string can and cannot do:
 *   - a valid `topic` / `ref` / `draft` arrives preselected and prefilled (D-02);
 *   - an invalid `ref` is dropped and appears nowhere in the HTML, so a crafted
 *     link cannot reflect text (T-164.6.6.3.5-15);
 *   - the shell is `/security`'s: one `<main>`, one `<h1>`, the spec's copy.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import ContactPage, { metadata } from "./page";

type Params = Record<string, string | string[] | undefined>;

async function renderPage(params: Params) {
  const ui = await ContactPage({ searchParams: Promise.resolve(params) });
  return { ui, ...render(ui) };
}

describe("/contact page shell", () => {
  it("renders one main, one h1 `Contact` and the lead paragraph verbatim", async () => {
    const { container } = await renderPage({});
    expect(container.querySelectorAll("main")).toHaveLength(1);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Contact");
    expect(
      screen.getByText(
        "Support questions, security reports and privacy requests all come here. The founder reads every message and replies to the email address you give, within one business day.",
      ),
    ).toBeInTheDocument();
  });

  it("is public and indexable with /contact as canonical", () => {
    expect(metadata.title).toBe("Contact — Quantalyze");
    expect(metadata.alternates?.canonical).toBe("/contact");
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("closes with the Security reports note linking the security page, naming the path in <code>", async () => {
    const { container } = await renderPage({});
    expect(
      screen.getByRole("heading", { level: 2, name: "Security reports" }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "security page" });
    expect(link).toHaveAttribute("href", "/security#security-contact");
    const code = container.querySelector("code");
    expect(code).toHaveTextContent("/.well-known/security.txt");
  });

  it("uses no card around the form and no autofocus", async () => {
    const { container } = await renderPage({});
    expect(container.querySelector("form")?.closest("[class*='shadow']")).toBeNull();
    expect(container.querySelector("[autofocus]")).toBeNull();
  });
});

describe("/contact page prefill (D-02)", () => {
  it("preselects the topic and prefills the reference in Geist Mono from a valid link", async () => {
    await renderPage({
      topic: "security",
      ref: "cid-0123456789",
      draft: "9a2e9a2e-1111",
    });
    expect((screen.getByLabelText("Topic") as HTMLSelectElement).value).toBe(
      "security",
    );
    const reference = screen.getByLabelText(
      "Reference (optional)",
    ) as HTMLInputElement;
    expect(reference.value).toBe("cid-0123456789 draft 9a2e9a2e-1111");
    expect(reference.className).toContain("font-metric");
  });

  it("falls back to General question and an empty reference with no query", async () => {
    await renderPage({});
    expect((screen.getByLabelText("Topic") as HTMLSelectElement).value).toBe(
      "general",
    );
    expect((screen.getByLabelText("Reference (optional)") as HTMLInputElement).value).toBe("");
  });

  it("drops an invalid ref: the field is empty and the value is nowhere in the HTML", async () => {
    const { ui } = await renderPage({ ref: "<script>x</script>" });
    expect((screen.getByLabelText("Reference (optional)") as HTMLInputElement).value).toBe("");
    const html = renderToStaticMarkup(ui);
    expect(html).not.toContain("script>x");
    expect(html).not.toContain("&lt;script");
  });

  it("drops an unknown topic to General question", async () => {
    await renderPage({ topic: "<b>evil</b>" });
    expect((screen.getByLabelText("Topic") as HTMLSelectElement).value).toBe(
      "general",
    );
  });
});
