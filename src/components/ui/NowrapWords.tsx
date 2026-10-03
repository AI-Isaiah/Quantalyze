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
 *
 * `breakOverlong` (170 review WR-02) is for a site that does not scroll: a
 * nowrap word wider than its container cannot break at all, so a long
 * hyphenated name overflowed `/strategies` at 390 px. With the prop each word
 * is an atomic `inline-block` capped at the container width instead. A word
 * that fits on a line still moves to the next line whole, exactly as nowrap
 * does; only a word wider than the whole line breaks inside itself (at its
 * hyphens first, then anywhere). The default stays `whitespace-nowrap`, so a
 * scrolling site such as StrategyTable keeps its column width unchanged.
 */
export function NowrapWords({
  text,
  breakOverlong = false,
}: {
  text: string;
  breakOverlong?: boolean;
}) {
  const wordClass = breakOverlong
    ? "inline-block max-w-full [overflow-wrap:anywhere]"
    : "whitespace-nowrap";
  const words = text.split(" ");
  const children: ReactNode[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i > 0) children.push(" ");
    children.push(
      <span key={i} className={wordClass}>
        {words[i]}
      </span>,
    );
  }
  return <div className="contents">{children}</div>;
}
