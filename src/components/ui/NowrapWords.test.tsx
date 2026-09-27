/**
 * Phase 170-05 / AD-13 — a hyphenated word must never break at its hyphen.
 *
 * U+2011 was rejected: DM Sans may lack the glyph, and a fallback font would
 * violate DESIGN.md. Each space-separated word is therefore a
 * whitespace-nowrap span. The spans MUST be joined by literal space text
 * nodes, or the container's textContent stops equalling the input (PC-5)
 * and every page.key-pill.test.tsx noteOf() lookup goes silent-red.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import * as nowrapWords from "./NowrapWords";

function loadNowrapWords(): (props: { text: string }) => ReturnType<typeof createElement> {
  const mod = nowrapWords as {
    NowrapWords?: (props: { text: string }) => ReturnType<typeof createElement>;
  };
  expect(mod.NowrapWords, "NowrapWords must be exported").toEqual(
    expect.any(Function),
  );
  return mod.NowrapWords!;
}

describe("NowrapWords", () => {
  it("wraps each space-separated word in a whitespace-nowrap span, joined by literal spaces", () => {
    const NowrapWords = loadNowrapWords();
    const { container } = render(
      createElement(NowrapWords, { text: "Alpha Long-Short Beta" }),
    );

    const spans = [...container.querySelectorAll("span")];
    expect(spans.map((s) => s.textContent)).toEqual([
      "Alpha",
      "Long-Short",
      "Beta",
    ]);
    for (const span of spans) {
      expect(span.className).toContain("whitespace-nowrap");
    }

    const texts = [...container.firstElementChild!.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent);
    expect(texts).toEqual([" ", " "]);
    expect(container.textContent).toBe("Alpha Long-Short Beta");
  });

  it("renders a single-word input as one nowrap span and no space text node", () => {
    const NowrapWords = loadNowrapWords();
    const { container } = render(createElement(NowrapWords, { text: "Alpha" }));

    const spans = [...container.querySelectorAll("span")];
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe("Alpha");
    expect(spans[0].className).toContain("whitespace-nowrap");
    const texts = [...container.firstElementChild!.childNodes].filter(
      (n) => n.nodeType === Node.TEXT_NODE,
    );
    expect(texts).toHaveLength(0);
    expect(container.textContent).toBe("Alpha");
  });
});
