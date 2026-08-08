/**
 * Phase 150 / Plan 150-02 — the shared dollar validator + the shared USD
 * formatter, both LIFTED (cut, not copied) from their prior single call sites:
 *
 *   - `isValidDollar` from `api/strategies/finalize-wizard/route.ts` (the
 *     aum / max_capacity guard, audit-2026-05-07 H-0325/H-0326)
 *   - `formatUsd` from `(dashboard)/allocations/components/HoldingsTable.tsx`
 *
 * Both are behaviour pins on a MOVE: every expectation below is a literal
 * typed into this file (never imported from the module under test, never from
 * `MAGNITUDE_CAPS`), so a drifted cap or a "cleaned up" formatter reddens here
 * rather than silently changing what a money surface accepts or renders.
 */

import { describe, it, expect } from "vitest";
import { isValidDollar, formatUsd } from "./dollar-validation";

// The AUM / capacity bound, typed in as a literal ORACLE — deliberately NOT
// `MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD`. Asserting a constant against itself
// proves nothing; this pins the economic boundary the route promises its
// clients ("a finite number in [0, 1e12)").
const MAX_DOLLAR_VALUE_LITERAL = 1_000_000_000_000;

describe("isValidDollar — the AUM / max-capacity bound", () => {
  it("pins the cap literal against the module's actual boundary", () => {
    expect(isValidDollar(MAX_DOLLAR_VALUE_LITERAL - 1)).toBe(true);
    expect(isValidDollar(MAX_DOLLAR_VALUE_LITERAL)).toBe(false);
  });

  it("accepts zero (a real, declarable AUM — not the same as omitted)", () => {
    expect(isValidDollar(0)).toBe(true);
  });

  it("accepts ordinary positive amounts", () => {
    expect(isValidDollar(1)).toBe(true);
    expect(isValidDollar(120_000)).toBe(true);
    expect(isValidDollar(1_000_000_000)).toBe(true);
    expect(isValidDollar(999_999_999_999.99)).toBe(true);
  });

  it("rejects negatives", () => {
    expect(isValidDollar(-1)).toBe(false);
    expect(isValidDollar(-0.01)).toBe(false);
  });

  it("rejects above-cap magnitudes (the 1e20 client-typo class)", () => {
    expect(isValidDollar(1_000_000_000_001)).toBe(false);
    expect(isValidDollar(1e20)).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    expect(isValidDollar(Number.NaN)).toBe(false);
    expect(isValidDollar(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidDollar(Number.NEGATIVE_INFINITY)).toBe(false);
  });

  it("rejects non-numbers — a numeric STRING is not a dollar value", () => {
    // The route's contract is "client must send a finite number"; coercion is
    // exactly the fail-quiet behaviour H-0325 replaced with fail-loud.
    expect(isValidDollar("1000")).toBe(false);
    expect(isValidDollar(null)).toBe(false);
    expect(isValidDollar(undefined)).toBe(false);
    expect(isValidDollar({})).toBe(false);
    expect(isValidDollar([])).toBe(false);
    expect(isValidDollar(true)).toBe(false);
  });
});

describe("formatUsd — the ONE money formatter for the allocations surface", () => {
  it("renders whole-dollar amounts with thousands separators and no cents", () => {
    expect(formatUsd(120000)).toBe("$120,000");
    expect(formatUsd(1000000000)).toBe("$1,000,000,000");
    expect(formatUsd(0)).toBe("$0");
  });

  it("rounds to whole dollars (0 fraction digits, both bounds)", () => {
    expect(formatUsd(1234.56)).toBe("$1,235");
    expect(formatUsd(999.5)).toBe("$1,000");
  });

  it("renders negatives with the locale's leading-minus form", () => {
    expect(formatUsd(-2500)).toBe("-$2,500");
  });

  it("renders the em-dash for a null amount — never $0 (no-invented-data)", () => {
    expect(formatUsd(null)).toBe("—");
  });
});
