import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TRUST_TIER_TOKENS } from "@/lib/design-tokens/trust-tier";

/**
 * Phase 17 / DESIGN-01 — DESIGN.md ↔ token consistency.
 *
 * Asserts:
 *   (a) every hex value in TRUST_TIER_TOKENS appears verbatim in DESIGN.md
 *   (b) every user-facing label appears verbatim in DESIGN.md
 *   (c) the new Trust-Tier Badges sub-section uses #B45309 exclusively and
 *       contains zero #D97706 references (drift detection, scoped to the
 *       new sub-section — pre-existing historical Decisions Log mentions
 *       that narrate the 2026-04-30 supersession are immutable history)
 *
 * This is the atomic CI gate against drift. Any DESIGN.md edit that drops
 * a hex breaks this test instantly; any token-file change that introduces
 * a new hex without a paired DESIGN.md update fails the same way.
 *
 * Mirrors chart-contrast.test.ts pattern — no extra deps, hand-rolled.
 */

const designMd = readFileSync(
  resolve(__dirname, "../../DESIGN.md"),
  "utf8",
);

const distinctHexes = Array.from(
  new Set(
    Object.values(TRUST_TIER_TOKENS).flatMap((v) => [v.fill, v.text, v.border]),
  ),
);

describe("DESIGN.md ↔ TRUST_TIER_TOKENS consistency (DESIGN-01)", () => {
  it.each(distinctHexes)("hex %s appears verbatim in DESIGN.md", (hex) => {
    expect(designMd.includes(hex)).toBe(true);
  });

  it.each(Object.entries(TRUST_TIER_TOKENS))(
    "%s label appears verbatim in DESIGN.md",
    (_variant, token) => {
      expect(designMd.includes(token.label)).toBe(true);
    },
  );

  // Phase 111 / CONSTIT-02 — the 4th provenance variant `composite`.
  // ProvenanceTier = TrustTier | "composite" is the badge-layer union; the DB
  // TrustTier union stays 3-valued (WatchlistPanel TIER_ORDER depends on it).
  describe("composite provenance variant (CONSTIT-02)", () => {
    it("exposes a composite token slot labelled 'Composite'", () => {
      expect(TRUST_TIER_TOKENS.composite).toBeDefined();
      expect(TRUST_TIER_TOKENS.composite.label).toBe("Composite");
    });

    it("composite token hexes + label appear verbatim in DESIGN.md (drift gate)", () => {
      const { fill, text, border, label } = TRUST_TIER_TOKENS.composite;
      for (const hex of [fill, text, border]) {
        expect(designMd.includes(hex)).toBe(true);
      }
      expect(designMd.includes(label)).toBe(true);
    });
  });

  it("new Trust-Tier Badges sub-section uses canonical #B45309 with zero #D97706 drift", () => {
    // The retired #D97706 hex legitimately appears in pre-existing historical
    // content (the `--color-warning` token row that records "Was #D97706 …
    // shifted 2026-04-30", plus 2026-04-11 / 2026-04-30 / 2026-05-01 Decisions
    // Log rows that narrate the supersession). Those mentions are immutable
    // record-keeping, not drift.
    //
    // The drift signal we DO care about: the NEW Trust-Tier Badges sub-section
    // (DESIGN-01) must use #B45309 exclusively. Any #D97706 inside that scoped
    // region indicates the token file has diverged from DESIGN.md.
    const start = designMd.indexOf("## Trust-Tier Badges");
    expect(start, "Trust-Tier Badges section missing from DESIGN.md").toBeGreaterThan(-1);
    const after = designMd.slice(start + "## Trust-Tier Badges".length);
    const nextHeading = after.search(/\n## [A-Z]/);
    const section = nextHeading === -1 ? after : after.slice(0, nextHeading);
    expect(
      section.includes("#D97706"),
      "Trust-Tier Badges sub-section must NOT reference retired #D97706",
    ).toBe(false);
    expect(
      section.includes("#B45309"),
      "Trust-Tier Badges sub-section must reference canonical #B45309",
    ).toBe(true);
  });
});
