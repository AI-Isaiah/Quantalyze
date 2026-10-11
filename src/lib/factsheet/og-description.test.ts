import { describe, it, expect } from "vitest";
import { shortenOgDescription } from "./og-description";

// Expected values are hand-built literals (`.repeat`), never produced by
// calling the helper or a sibling implementation.
describe("shortenOgDescription", () => {
  it("D-04 — a long description is cut at the last word boundary at or under 140 and ends with an ellipsis", () => {
    // 143 code points; the old raw cut ended "alpha om".
    const input = "alpha ".repeat(23) + "omega";
    expect(shortenOgDescription(input)).toBe("alpha ".repeat(22) + "alpha…");
  });

  it("D-04 — a description of exactly 140 code points is unchanged, with no ellipsis", () => {
    const at140 = "b".repeat(70) + " " + "c".repeat(69);
    expect(Array.from(at140)).toHaveLength(140);
    expect(shortenOgDescription(at140)).toBe(at140);
  });

  it("D-04 — 141 code points is shortened at the boundary", () => {
    const at141 = "b".repeat(70) + " " + "c".repeat(70);
    expect(Array.from(at141)).toHaveLength(141);
    expect(shortenOgDescription(at141)).toBe("b".repeat(70) + "…");
  });

  it("D-04 — when the head ends exactly at a word (the next code point is a space) the whole head is kept", () => {
    const input = "aa " + "b".repeat(137) + " cc";
    expect(Array.from(input)).toHaveLength(143);
    expect(shortenOgDescription(input)).toBe("aa " + "b".repeat(137) + "…");
  });

  it("D-04 — null, undefined and the empty string return an empty string without throwing", () => {
    expect(shortenOgDescription(null)).toBe("");
    expect(shortenOgDescription(undefined)).toBe("");
    expect(shortenOgDescription("")).toBe("");
  });

  it("D-05 — a single word longer than 140 is hard-cut at 140 and given an ellipsis", () => {
    expect(shortenOgDescription("y".repeat(141))).toBe("y".repeat(140) + "…");
    expect(shortenOgDescription("y".repeat(200))).toBe("y".repeat(140) + "…");
  });

  it("D-04 — a boundary before an overlong second word wins over the hard cut (D-05 does not apply)", () => {
    expect(shortenOgDescription("short " + "z".repeat(200))).toBe("short…");
  });

  it("D-06 — line breaks, tabs and runs of whitespace become single spaces and the ends are trimmed", () => {
    expect(shortenOgDescription("line one\n\n  line\ttwo  ")).toBe("line one line two");
  });

  it("D-06 — length is measured after the collapse: 149 raw, 140 collapsed, shown whole with no ellipsis", () => {
    const input = "a".repeat(100) + "\n".repeat(10) + "b".repeat(39);
    expect(Array.from(input)).toHaveLength(149);
    expect(shortenOgDescription(input)).toBe("a".repeat(100) + " " + "b".repeat(39));
  });

  it("D-06 — a whitespace-only description becomes the empty string (the route then renders no description line)", () => {
    expect(shortenOgDescription("   \n\t  ")).toBe("");
  });

  it("D-04 — counts code points, so a cut never splits a surrogate pair", () => {
    const out = shortenOgDescription("📈".repeat(141));
    expect(out).toBe("📈".repeat(140) + "…");
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});
