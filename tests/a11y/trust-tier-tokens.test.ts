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
 *   (c) the retired #D97706 hex appears AT MOST ONCE in DESIGN.md (only
 *       allowed in the 2026-04-11 Decisions Log row that records the
 *       2026-04-30 supersession to #B45309)
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

  it("retired hex #D97706 appears at most once (only the historical superseded row)", () => {
    const matches = designMd.match(/#D97706/g) ?? [];
    // The 2026-04-11 Decisions Log row records the supersession to #B45309
    // and intentionally still references the retired hex. Any second
    // occurrence is a regression.
    expect(matches.length).toBeLessThanOrEqual(1);
  });
});
