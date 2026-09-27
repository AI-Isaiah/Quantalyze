import { type ReactNode } from "react";

/**
 * A hyphenated token must never break at its hyphen (phase 170, AD-13).
 *
 * U+2011 was rejected: DM Sans may lack the glyph, and a fallback font would
 * violate DESIGN.md. Each space-separated word is a `whitespace-nowrap` span.
 * The spans are joined by literal space text nodes so a parent's `textContent`
 * equals `text` exactly (PATTERNS PC-5). Adjacent spans with no space children
 * drop those spaces, and `noteOf()` (`a.textContent === strategyName`) goes silent.
 *
 * The root is `display: contents` so the words stay in the parent's inline
 * flow. It is not a `span`: the word spans are the only spans, which is what
 * the textContent contract is checked against.
 */
export function NowrapWords({ text }: { text: string }) {
  const words = text.split(" ");
  const children: ReactNode[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i > 0) children.push(" ");
    children.push(
      <span key={i} className="whitespace-nowrap">
        {words[i]}
      </span>,
    );
  }
  return <div className="contents">{children}</div>;
}
