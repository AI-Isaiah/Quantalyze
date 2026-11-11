/**
 * Phase 198 / D-04, LEAN-06 — the dust rule: "a position worth under $50 or
 * under 0.1% of the book".
 *
 * Why the comparisons are strict: D-04 says "under", so a position worth
 * exactly $50, or exactly 0.1% of Book equity, is not dust. Hiding a row the
 * founder's rule does not cover would remove a real position from view.
 *
 * Why unpriced and untrusted rows are exempt: a row with no usable price has
 * no value to compare, and a row on a key that needs attention carries a
 * number that cannot be trusted. Hiding either as "small" would bury exactly
 * the rows that need the reader's eye (LEAN-06).
 */
import { describe, expect, it } from "vitest";
import {
  DUST_RULE_CAPTION,
  dustAnnouncement,
  dustControlLabel,
  dustHiddenLine,
  isDust,
} from "./dust";

const row = (valueUsd: number | null, over: { priced?: boolean; trustedKey?: boolean } = {}) => ({
  valueUsd,
  priced: over.priced ?? true,
  trustedKey: over.trustedKey ?? true,
});

describe("isDust: the absolute test", () => {
  it("a position under $50 is dust", () => {
    expect(isDust(row(49.99), 1_000_000)).toBe(true);
  });

  // The two tests are an OR, so the absolute test is isolated with a book
  // small enough that 0.1% of it is below $50 (here $10).
  it("a position worth exactly $50 is not dust (strict)", () => {
    expect(isDust(row(50), 10_000)).toBe(false);
    expect(isDust(row(49.99), 10_000)).toBe(true);
  });

  it("is a magnitude test, so a short worth -$49 is dust", () => {
    expect(isDust(row(-49), 1_000_000)).toBe(true);
  });

  it("a short worth -$50 is not dust", () => {
    expect(isDust(row(-50), 10_000)).toBe(false);
  });
});

describe("isDust: the share-of-book test", () => {
  it("under 0.1% of Book equity is dust", () => {
    expect(isDust(row(999.99), 1_000_000)).toBe(true);
  });

  it("exactly 0.1% of Book equity is not dust (strict)", () => {
    expect(isDust(row(1000), 1_000_000)).toBe(false);
  });

  it("a position worth exactly $50 is dust on a large book (under 0.1% of it)", () => {
    expect(isDust(row(50), 1_000_000)).toBe(true);
  });

  it("a position that is exactly $50 and exactly 0.1% of the book is not dust", () => {
    expect(isDust(row(50), 50_000)).toBe(false);
  });

  it("a $60 position is dust on a large book (under 0.1%) though over $50", () => {
    expect(isDust(row(60), 1_000_000)).toBe(true);
  });
});

describe("isDust: no usable Book equity", () => {
  it.each([null, Number.NaN, 0, -5, Number.POSITIVE_INFINITY])(
    "with Book equity %s only the $50 test applies",
    (equity) => {
      expect(isDust(row(60), equity)).toBe(false);
      expect(isDust(row(40), equity)).toBe(true);
    },
  );
});

describe("isDust: rows that are never dust", () => {
  it("an unpriced row is never dust, even at $1", () => {
    expect(isDust(row(1, { priced: false }), 1_000_000)).toBe(false);
  });

  it("a row on an untrusted or disconnected key is never dust, even at $1", () => {
    expect(isDust(row(1, { trustedKey: false }), 1_000_000)).toBe(false);
  });

  it("a non-finite or missing value is never dust", () => {
    expect(isDust(row(Number.NaN), 1_000_000)).toBe(false);
    expect(isDust(row(null), 1_000_000)).toBe(false);
    expect(isDust(row(Number.POSITIVE_INFINITY), 1_000_000)).toBe(false);
  });
});

describe("dust copy", () => {
  it("the control label is singular for one row and flips when expanded", () => {
    expect(dustControlLabel(1, false)).toBe("Show 1 small position");
    expect(dustControlLabel(3, false)).toBe("Show 3 small positions");
    expect(dustControlLabel(3, true)).toBe("Hide small positions");
    expect(dustControlLabel(1, true)).toBe("Hide small positions");
  });

  it("the announcement says shown or hidden and is singular for one row", () => {
    expect(dustAnnouncement(1, true)).toBe("1 small position shown.");
    expect(dustAnnouncement(4, false)).toBe("4 small positions hidden.");
    expect(dustAnnouncement(1, false)).toBe("1 small position hidden.");
  });

  it("the empty-table line is singular for one row", () => {
    expect(dustHiddenLine(1)).toBe("1 small position hidden.");
    expect(dustHiddenLine(2)).toBe("2 small positions hidden.");
  });

  it("the caption states the rule the function implements", () => {
    expect(DUST_RULE_CAPTION).toBe(
      "Small positions are under $50 or under 0.1% of allocation equity.",
    );
  });
});
