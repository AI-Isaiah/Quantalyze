import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 153.2 review WR-04 — DESIGN.md's decision changelog must actually RENDER.
 *
 * ⭐ THE DEFECT THIS EXISTS FOR. The 2026-08-09 measure-ladder ruling was
 * appended to a file whose last line carried no trailing newline, so the new row
 * began mid-line:
 *
 *     | 2026-07-16 | Sidebar navy … neutral token. || 2026-08-09 | Dense tables …
 *
 * A markdown row must start on its own line. As written, the founder's ruling,
 * the A/B/C options and the rationale were parsed as trailing cells of the
 * *Sidebar navy* row and dropped by every renderer that honours the header's
 * column count — invisible in the document `CLAUDE.md` requires be read before
 * any visual decision. The same review found a second instance of the same class
 * (an unescaped `|` inside a code span in the CONSTIT-02 row, truncating its
 * rationale), which is why this guard is written over the WHOLE table rather
 * than as two assertions about two rows.
 *
 * ⛔ IT IS A RENDERING CLAIM, NOT A PROSE CLAIM. Nothing here reads the
 * decisions' wording, so it cannot bit-rot against an edit and cannot be
 * satisfied by rephrasing. It asserts only what a markdown renderer asserts:
 * every row starts a line, and every row has the header's column count.
 */

const DESIGN = join(process.cwd(), "DESIGN.md");
const src = readFileSync(DESIGN, "utf8");
const lines = src.split("\n");

/** Cells in a markdown row, honouring backslash-escaped pipes. */
function cellCount(row: string): number {
  return row.split(/(?<!\\)\|/).length - 2;
}

describe("[153.2 WR-04] DESIGN.md decision changelog renders as a table", () => {
  const headerIdx = lines.findIndex((l) => /^\|\s*Date\s*\|/i.test(l));

  it("the changelog table is found at all (anti-vacuity floor)", () => {
    // Without this, a renamed header would make every assertion below iterate
    // an empty set and pass while guarding nothing.
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(cellCount(lines[headerIdx]!)).toBe(3);
  });

  it("has more than a handful of decision rows (anti-vacuity floor)", () => {
    const rows = lines
      .slice(headerIdx + 2)
      .filter((l) => l.trim().startsWith("|"));
    expect(rows.length).toBeGreaterThan(20);
  });

  it("⭐ every decision row carries exactly the header's column count", () => {
    const header = lines[headerIdx]!;
    const offenders = lines
      .slice(headerIdx + 2)
      .map((l, i) => ({ line: headerIdx + 3 + i, text: l }))
      .filter((r) => r.text.trim().startsWith("|"))
      .filter((r) => cellCount(r.text) !== cellCount(header))
      // Report the date cell, which is what a human needs to find the row —
      // not a 3000-character diff.
      .map((r) => `${r.line}: ${r.text.slice(0, 60)}… (${cellCount(r.text)} cells)`);

    expect(offenders).toEqual([]);
  });

  it("the file ends with a newline, so the next appended row starts its own line", () => {
    // The direct cause of the WR-04 defect: a `cat >>` onto a file with no
    // trailing newline concatenates rather than appends.
    expect(src.endsWith("\n")).toBe(true);
  });
});
