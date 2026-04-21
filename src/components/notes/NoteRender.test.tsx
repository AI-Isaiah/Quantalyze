/**
 * Phase 08 Plan 03 — NoteRender.test.tsx
 *
 * XSS fuzz + GFM passthrough. react-markdown escapes raw HTML by default,
 * rehype-sanitize is the belt-and-suspenders backstop. `<img>` is filtered
 * out of the schema (UI-SPEC §5 — no forms/media in notes). `<a>` tags get
 * rel="noopener noreferrer" + target="_blank".
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NoteRender } from "./NoteRender";

describe("NoteRender", () => {
  it("renders headings and bold from markdown", () => {
    const { container } = render(<NoteRender content={"# Heading\n**bold**"} />);
    expect(container.querySelector("h1")?.textContent).toBe("Heading");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("strips <script> tags (XSS raw-HTML backstop)", () => {
    const { container } = render(
      <NoteRender content={"<script>alert(1)</script>hi"} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent ?? "").not.toContain("alert(1)");
  });

  it("strips <img> tags (no media allowed in notes)", () => {
    const { container } = render(
      <NoteRender content={"<img src=x onerror=alert(1)>"} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("strips <iframe> tags", () => {
    const { container } = render(
      <NoteRender content={'<iframe src="https://evil"></iframe>'} />,
    );
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("strips javascript: hrefs (href protocol allowlist)", () => {
    const { container } = render(
      <NoteRender content={"[link](javascript:alert(1))"} />,
    );
    const a = container.querySelector("a");
    // Either the <a> is dropped entirely (children rendered as plain text)
    // or its href is absent/empty after sanitization.
    if (a) {
      const href = a.getAttribute("href") ?? "";
      expect(href).not.toContain("javascript:");
    }
    expect(container.textContent ?? "").not.toContain("javascript:alert");
  });

  it("rewrites https <a> tags with rel=noopener noreferrer + target=_blank", () => {
    const { container } = render(
      <NoteRender content={"[ok](https://example.com)"} />,
    );
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a?.getAttribute("target")).toBe("_blank");
  });

  it("renders GFM tables (pipe syntax)", () => {
    const md = [
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const { container } = render(<NoteRender content={md} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("thead")).not.toBeNull();
    expect(container.querySelector("tbody")).not.toBeNull();
    expect(container.querySelector("th")).not.toBeNull();
    expect(container.querySelector("td")).not.toBeNull();
  });

  it("renders GFM strikethrough as <del>", () => {
    const { container } = render(<NoteRender content={"~~strike~~"} />);
    expect(container.querySelector("del")?.textContent).toBe("strike");
  });

  it("renders GFM task list items without literal [x] (input tag is filtered)", () => {
    // The sanitize schema filters <input>, so the rendered task-list item
    // contains the label text ("done") without the raw markdown marker.
    const { container } = render(<NoteRender content={"- [x] done"} />);
    const li = container.querySelector("li");
    expect(li).not.toBeNull();
    expect(li?.textContent ?? "").toContain("done");
    // No literal `[x]` marker should leak through as plain text.
    expect(li?.textContent ?? "").not.toContain("[x]");
  });
});
