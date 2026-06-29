import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TYPE_SCALE } from "@/lib/design-tokens/typography";

/**
 * Phase 49 / DS-03 — three-way fluid type-token drift gate + no-inline guard.
 *
 * Pins the fluid `--text-*` spine so DESIGN.md, the plain `@theme` block of
 * globals.css, and the TS mirror (`TYPE_SCALE`) can never silently drift
 * (49-RESEARCH Pattern 4):
 *   (1) for every tier, the plain `@theme` block contains
 *       `--text-${tier}: ${TYPE_SCALE[tier].clamp}` verbatim (CSS <-> TS);
 *   (2) NO `@theme inline` block contains a `--text-` token — `@theme inline`
 *       bakes the clamp literal into each utility and flattens the var() chain,
 *       defeating clamp re-evaluation on zoom (WCAG 1.4.4). The fluid spine MUST
 *       live in the sibling plain `@theme` block (the CONTEXT-called-out guard).
 *       Checked across EVERY inline block (not just the first), so a second
 *       `@theme inline {` can't smuggle a `--text-*` token past the guard;
 *   (3) the TS mirror declares >= 8 tiers;
 *   (4) each tier's full `clamp(...)` string AND its `minPx→maxPx` px endpoints
 *       appear verbatim in DESIGN.md's sliced §Fluid Type Spine section
 *       (DESIGN <-> TS) — not a bare integer matched anywhere in the doc.
 *
 * Mirrors `tests/a11y/trust-tier-tokens.test.ts` (DESIGN.md-parse +
 * `includes(...)` verbatim-assert + section-slice idiom) — no parser dep.
 *
 * Wave-0 (49-01) state: this test is intentionally RED. `TYPE_SCALE` is empty
 * and no plain `@theme` block exists yet, so the explicit ">= 8 tiers"
 * assertion fails (and keeps the suite from being vacuously green while the
 * per-tier `it.each` blocks have zero cases). It goes GREEN when 49-02 (Wave 1)
 * fills `TYPE_SCALE`, adds the plain `@theme {--text-*}` block, and adds the px
 * endpoints to DESIGN.md.
 */

const designMd = readFileSync(resolve(__dirname, "../../DESIGN.md"), "utf8");
const css = readFileSync(
  resolve(__dirname, "../../src/app/globals.css"),
  "utf8",
);

/**
 * Returns the body between a matched `@theme` opener and its balanced closing
 * brace. Hand-rolled brace-balancer (no CSS-parser dependency, matching the
 * no-extra-deps ethos of every existing drift test). Returns "" when the
 * opener does not match — so a missing plain `@theme` block fails the
 * verbatim-contains assertions cleanly instead of throwing on collection.
 */
function extractBlock(source: string, openRegex: RegExp): string {
  const open = openRegex.exec(source);
  if (!open) return "";
  const bodyStart = open.index + open[0].length;
  let depth = 1;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i);
    }
  }
  return source.slice(bodyStart);
}

/**
 * Returns the concatenated body of EVERY `@theme inline { … }` block. The
 * single-match `extractBlock` only sees the first opener, so a SECOND
 * `@theme inline` block could hide a `--text-*` token from the no-inline
 * guard. Walk all openers (matchAll) and balance each one's braces so the
 * guard is independently load-bearing regardless of how many inline blocks
 * the stylesheet grows.
 */
function extractAllInlineBlocks(source: string): string {
  let out = "";
  for (const m of source.matchAll(/@theme\s+inline\s*\{/g)) {
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let i = bodyStart;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
    }
    // i now points one past the matching `}` (or EOF); body is bodyStart..i-1.
    out += source.slice(bodyStart, depth === 0 ? i - 1 : i);
    out += "\n";
  }
  return out;
}

/**
 * Slices the `### Fluid Type Spine` section out of DESIGN.md — from that
 * heading up to the next `##`/`###` heading — so the DESIGN↔TS drift leg
 * asserts against the documented type-spine TABLE specifically, not a bare
 * integer that could match anywhere in the 290-line doc. Mirrors the
 * section-slice idiom in `tests/a11y/trust-tier-tokens.test.ts`.
 */
function fluidTypeSpineSection(md: string): string {
  const heading = "### Fluid Type Spine";
  const start = md.indexOf(heading);
  if (start === -1) return "";
  const after = md.slice(start + heading.length);
  const next = after.search(/\n#{2,3} /);
  return next === -1 ? after : after.slice(0, next);
}

const inlineBlock = extractAllInlineBlocks(css);
const plainBlock = extractBlock(css, /@theme\s*\{(?!\s*inline)/);
const fluidSpine = fluidTypeSpineSection(designMd);

describe("fluid type-token drift gate (DS-03)", () => {
  // Explicit top-level guard so the suite is RED (not vacuously green) while
  // TYPE_SCALE is empty and the per-tier it.each blocks have zero cases.
  it("declares >= 8 tiers", () => {
    expect(Object.keys(TYPE_SCALE).length).toBeGreaterThanOrEqual(8);
  });

  it.each(Object.entries(TYPE_SCALE))(
    "tier %s clamp appears verbatim in the plain @theme block (CSS <-> TS)",
    (tier, t) => {
      expect(plainBlock).toContain(`--text-${tier}: ${t.clamp}`);
    },
  );

  it.each(Object.entries(TYPE_SCALE))(
    "tier %s does NOT regress into the @theme inline block (zoom-safety)",
    (tier) => {
      expect(inlineBlock).not.toContain(`--text-${tier}`);
    },
  );

  // Guard the §Fluid Type Spine section was actually located — otherwise the
  // per-tier asserts below would vacuously pass against an empty slice if the
  // heading is ever renamed or the section deleted.
  it("locates the §Fluid Type Spine section in DESIGN.md", () => {
    expect(fluidSpine.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(TYPE_SCALE))(
    "tier %s clamp + px endpoints appear in DESIGN.md §Fluid Type Spine (DESIGN <-> TS)",
    (_tier, t) => {
      // Assert against the SLICED spine section (not the whole 290-line doc) so
      // a corrupted/removed row fails: a bare `toContain(minPx)` substring match
      // anywhere in the doc let the documented endpoints drift while green. The
      // table formats endpoints `min→max` (e.g. `32→48`) in one cell and the
      // full clamp() string in the next; both must survive verbatim.
      expect(fluidSpine).toContain(t.clamp);
      expect(fluidSpine).toContain(`${t.minPx}→${t.maxPx}`);
    },
  );
});
