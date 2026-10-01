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

type NowrapWordsProps = { text: string; breakOverlong?: boolean };

function loadNowrapWords(): (props: NowrapWordsProps) => ReturnType<typeof createElement> {
  const mod = nowrapWords as {
    NowrapWords?: (props: NowrapWordsProps) => ReturnType<typeof createElement>;
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

  // 170 review WR-02: a nowrap word cannot break at all, so on a page that
  // does not scroll (/strategies) a long hyphenated name overflowed at 390 px.
  // breakOverlong makes each word an atomic inline-block capped at the line
  // width: whole when it fits on a line (AD-13 still holds), breakable only
  // when it is wider than the line. Measured in Chromium (170-REVIEW-FIX-A).
  // jsdom has no layout, so this pins the classes that carry that behaviour.
  it("breakOverlong renders capped inline-block words that are not nowrap, same textContent", () => {
    const NowrapWords = loadNowrapWords();
    const text = "Delta-Neutral-Funding-Rate-Arbitrage-BTC Beta";
    const { container } = render(createElement(NowrapWords, { text, breakOverlong: true }));

    const spans = [...container.querySelectorAll("span")];
    expect(spans.map((s) => s.textContent)).toEqual([
      "Delta-Neutral-Funding-Rate-Arbitrage-BTC",
      "Beta",
    ]);
    for (const span of spans) {
      const tokens = span.className.split(/\s+/);
      for (const token of ["inline-block", "max-w-full", "[overflow-wrap:anywhere]"]) {
        expect(tokens).toContain(token);
      }
      // nowrap forbids every soft wrap, overflow-wrap included.
      expect(tokens).not.toContain("whitespace-nowrap");
    }
    expect(container.textContent).toBe(text);
  });

  it("keeps the default nowrap path when breakOverlong is false", () => {
    // StrategyTable relies on this: its name sits in a scroller, and an
    // inline-block word would change the table's min-content column width.
    const NowrapWords = loadNowrapWords();
    const { container } = render(
      createElement(NowrapWords, { text: "Alpha Long-Short", breakOverlong: false }),
    );
    for (const span of container.querySelectorAll("span")) {
      expect(span.className).toBe("whitespace-nowrap");
    }
  });
});
