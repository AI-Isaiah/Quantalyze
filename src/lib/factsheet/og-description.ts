/**
 * Shortens a strategy description for the dynamic OG share card
 * (`src/app/api/og/factsheet/[id]/route.tsx`). Pure and total: it never throws.
 *
 * Phase 170.3 OGPUBLIC contract:
 *  - D-06: line breaks and runs of whitespace collapse to single spaces and the
 *    ends are trimmed BEFORE measuring and cutting, so the budget is spent on
 *    visible text. A whitespace-only description becomes "" (the route then
 *    renders no description line).
 *  - D-04: a description of `max` code points or fewer is returned unchanged.
 *    A longer one is cut at the last word boundary at or under `max`, then `…`
 *    is appended.
 *  - D-05: a single word longer than `max` (no boundary to cut at) is hard-cut
 *    at `max` and given `…`.
 *
 * Discretion choices (CONTEXT "Claude's Discretion"):
 *  - The kept text is at most `max` code points and `…` (U+2026, one code point)
 *    is appended after it, so a shortened description is at most `max + 1` code
 *    points. The rendered text never ends mid-word except under D-05.
 *  - Characters are counted as code points (`Array.from`), not UTF-16 units, so
 *    a cut never splits a surrogate pair.
 */
export function shortenOgDescription(
  input: string | null | undefined,
  max = 140,
): string {
  if (input == null) return "";

  const normalized = input.replace(/\s+/g, " ").trim();
  const codePoints = Array.from(normalized);
  if (codePoints.length <= max) return normalized;

  const head = codePoints.slice(0, max);
  let kept: string;
  if (codePoints[max] === " ") {
    // The head ends exactly at a word: keep all of it.
    kept = head.join("");
  } else {
    const lastSpace = head.lastIndexOf(" ");
    // No boundary at all: one word longer than `max` (D-05), hard-cut.
    kept = (lastSpace > 0 ? head.slice(0, lastSpace) : head).join("");
  }
  return kept.trimEnd() + "…";
}
