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
 *   (2) the `@theme inline` block contains NO `--text-` token — `@theme inline`
 *       bakes the clamp literal into each utility and flattens the var() chain,
 *       defeating clamp re-evaluation on zoom (WCAG 1.4.4). The fluid spine MUST
 *       live in the sibling plain `@theme` block (the CONTEXT-called-out guard);
 *   (3) the TS mirror declares >= 8 tiers;
 *   (4) each tier's minPx appears verbatim in DESIGN.md §Typography (DESIGN <-> TS).
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

const inlineBlock = extractBlock(css, /@theme\s+inline\s*\{/);
const plainBlock = extractBlock(css, /@theme\s*\{(?!\s*inline)/);

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

  it.each(Object.entries(TYPE_SCALE))(
    "tier %s minPx appears verbatim in DESIGN.md §Typography (DESIGN <-> TS)",
    (_tier, t) => {
      expect(designMd).toContain(String(t.minPx));
    },
  );
});
