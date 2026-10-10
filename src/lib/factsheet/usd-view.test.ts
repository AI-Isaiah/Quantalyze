import { describe, expect, it } from "vitest";
import { buildUsdViewFacts } from "./usd-view";

/**
 * Phase 164.6.6.2.1 plan 11 (D-06, D-22) — hand-built cases for the honesty facts.
 *
 * The pairing rule being mirrored (convertNativeReturnsToUsd): native day d_k has a
 * USD return only when EVERY calendar day of [d_{k-1}, d_k] has a stored close. The
 * USD dates in each case are therefore written out by hand from that rule, not
 * produced by calling the converter, so the facts builder is judged against the
 * rule and not against itself.
 */
const days = (month: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `2026-${month}-${String(from + i).padStart(2, "0")}`);
const closes = (...ds: string[]) => new Set(ds);

describe("buildUsdViewFacts", () => {
  it("an unpriced native day followed by a native day removes BOTH returns: one 2-day run", () => {
    // Native Oct 1..6. No close on Oct 3. Oct 2 needs [Oct 1, Oct 2]: ok. Oct 3 needs
    // Oct 3: absent. Oct 4 needs [Oct 3, Oct 4]: absent. Oct 5 and 6 are priced.
    const facts = buildUsdViewFacts(
      days("10", 1, 6),
      ["2026-10-02", "2026-10-05", "2026-10-06"],
      closes("2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05", "2026-10-06"),
    );
    expect(facts.missingSegments).toEqual([{ start: "2026-10-03", end: "2026-10-04", kind: "gap", days: 2 }]);
    expect(facts.unpricedDays).toEqual(["2026-10-03"]);
    expect(facts.removedReturns).toBe(2);
    expect(facts.leadingHole).toBe(false);
    expect(facts.usdStart).toBe("2026-10-02");
    expect(facts.usdEnd).toBe("2026-10-06");
  });

  it("an unpriced day BETWEEN two native days removes only the later return", () => {
    // Native Oct 1, 2, 3, 5, 6 (Oct 4 is not a native day), no close on Oct 4.
    // Oct 5 needs [Oct 3, Oct 5], which holds Oct 4: absent. Oct 6 needs [Oct 5, Oct 6]: ok.
    const facts = buildUsdViewFacts(
      ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05", "2026-10-06"],
      ["2026-10-02", "2026-10-03", "2026-10-06"],
      closes("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05", "2026-10-06"),
    );
    expect(facts.removedReturns).toBe(1);
    expect(facts.unpricedDays).toEqual(["2026-10-04"]);
    expect(facts.missingSegments).toEqual([{ start: "2026-10-05", end: "2026-10-05", kind: "gap", days: 1 }]);
    expect(facts.leadingHole).toBe(false);
  });

  it("two separate holes make two runs and a sorted, de-duplicated unpriced list", () => {
    // Native Oct 1..10. No close on Oct 3 and Oct 8. Removed: 3, 4 and 8, 9.
    const facts = buildUsdViewFacts(
      days("10", 1, 10),
      ["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-10"],
      closes(...days("10", 1, 10).filter((d) => d !== "2026-10-03" && d !== "2026-10-08")),
    );
    expect(facts.missingSegments).toEqual([
      { start: "2026-10-03", end: "2026-10-04", kind: "gap", days: 2 },
      { start: "2026-10-08", end: "2026-10-09", kind: "gap", days: 2 },
    ]);
    expect(facts.unpricedDays).toEqual(["2026-10-03", "2026-10-08"]);
    expect(facts.removedReturns).toBe(4);
  });

  it("a leading hole: closes that start late make USD start after the native second date", () => {
    // Native Oct 1..8, closes from Oct 4. Oct 5 is the first day whose interval
    // [Oct 4, Oct 5] is priced. Oct 2..4 are the LEADING stretch, not interior removals.
    const facts = buildUsdViewFacts(
      days("10", 1, 8),
      days("10", 5, 8),
      closes(...days("10", 4, 8)),
    );
    expect(facts.usdStart).toBe("2026-10-05");
    expect(facts.leadingHole).toBe(true);
    expect(facts.missingSegments).toEqual([]);
    expect(facts.unpricedDays).toEqual([]);
    expect(facts.removedReturns).toBe(0);
  });

  it("the first-day offset alone is not a hole", () => {
    const facts = buildUsdViewFacts(days("10", 1, 6), days("10", 2, 6), closes(...days("10", 1, 6)));
    expect(facts.usdStart).toBe("2026-10-02");
    expect(facts.leadingHole).toBe(false);
  });

  it("a tail gap is not a hole and removes nothing", () => {
    // Closes end Oct 4, native runs to Oct 6: USD ends Oct 4.
    const facts = buildUsdViewFacts(days("10", 1, 6), days("10", 2, 4), closes(...days("10", 1, 4)));
    expect(facts.usdEnd).toBe("2026-10-04");
    expect(facts.missingSegments).toEqual([]);
    expect(facts.removedReturns).toBe(0);
    expect(facts.unpricedDays).toEqual([]);
    expect(facts.leadingHole).toBe(false);
  });

  it("a fully priced series has no facts to name", () => {
    const facts = buildUsdViewFacts(days("10", 1, 6), days("10", 2, 6), closes(...days("10", 1, 6)));
    expect(facts).toEqual({
      missingSegments: [],
      unpricedDays: [],
      removedReturns: 0,
      usdStart: "2026-10-02",
      usdEnd: "2026-10-06",
      leadingHole: false,
    });
  });

  it("an absent native placeholder day with priced closes is not blamed on the price", () => {
    // Oct 3 is a native placeholder (no native return), so USD skips it for a native
    // reason. Every close is stored, so no removal is price-caused and none is counted.
    const facts = buildUsdViewFacts(
      days("10", 1, 6),
      ["2026-10-02", "2026-10-04", "2026-10-05", "2026-10-06"],
      closes(...days("10", 1, 6)),
    );
    expect(facts.removedReturns).toBe(0);
    expect(facts.missingSegments).toEqual([]);
    expect(facts.unpricedDays).toEqual([]);
  });

  it("refuses to describe a USD view with no priced day", () => {
    expect(() => buildUsdViewFacts(days("10", 1, 6), [], closes())).toThrow(/at least one priced day/);
  });
});
