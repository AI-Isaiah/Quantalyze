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
import {
  isValidDollar,
  formatUsd,
  formatUsdPrice,
  formatUsdSigned,
  signAtCents,
} from "./dollar-validation";

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

  // 2026-09-29, Phase 169 review round 1 (IN-04 + SFH L-3). The private copy in
  // HoldingDetail.tsx guarded non-finite input and this module did not, so
  // routing it here must not turn a NaN allocation into "$NaN". And an amount
  // that rounds to zero dollars reads "$0", never "-$0": the sign is the one of
  // the ROUNDED value, the rule formatUsdSigned/signAtCents already follow.
  it("renders the em-dash for a non-finite amount — never $NaN or $∞", () => {
    expect(formatUsd(Number.NaN)).toBe("—");
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatUsd(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("an amount that rounds to zero dollars carries no sign — never -$0", () => {
    expect(formatUsd(-0)).toBe("$0");
    expect(formatUsd(-0.4)).toBe("$0");
    // Half away from zero, as toLocaleString rounds: -0.5 is a real -$1.
    expect(formatUsd(-0.5)).toBe("-$1");
  });
});

/**
 * Phase 169 D-50 (founder UAT 2026-09-27) — /allocations Open Positions showed a
 * $0.42 entry or mark price as "$0", a +$0.37 P&L as "+$0", and a tiny negative
 * as a red "−$0". The whole-dollar `formatUsd` above is RIGHT for amounts (AUM,
 * notional, allocations) and stays pinned unchanged; prices and P&L get their
 * own formatters here. Every expectation is a typed literal.
 */
describe("[169 D-50] formatUsdPrice — a price keeps its real precision", () => {
  it("a price under $1 shows 4 significant digits, never $0", () => {
    expect(formatUsdPrice(0.4213)).toBe("$0.4213");
    expect(formatUsdPrice(0.00009876)).toBe("$0.00009876");
  });

  it("a price of $1 or more shows 2 decimals", () => {
    expect(formatUsdPrice(60000)).toBe("$60,000.00");
    expect(formatUsdPrice(1)).toBe("$1.00");
  });

  it("a sub-dollar price that rounds to $1 at 4 significant digits reads as a $1-or-more price", () => {
    // 0.99999 at 4 significant digits is "1.000"; the reader sees a $1 price,
    // so it takes the $1-or-more form rather than a 3-decimal hybrid.
    expect(formatUsdPrice(0.99999)).toBe("$1.00");
  });

  it("a zero price has no significant digits to show and reads $0.00", () => {
    expect(formatUsdPrice(0)).toBe("$0.00");
  });

  // 2026-09-29, Phase 169 review round 1 SFH L-3 (measured by the reviewer): a
  // mark derived as 0 / -qty is -0, which took the 2-decimal branch and
  // printed "-$0.00". No signed zero, as with formatUsdSigned.
  it("a negative-zero price reads $0.00, never -$0.00", () => {
    expect(formatUsdPrice(-0)).toBe("$0.00");
  });

  it("null and non-finite render the em-dash", () => {
    expect(formatUsdPrice(null)).toBe("—");
    expect(formatUsdPrice(Number.NaN)).toBe("—");
    expect(formatUsdPrice(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("[169 D-50] formatUsdSigned — P&L at 2 decimals, sign from the ROUNDED value", () => {
  it("a sub-dollar gain or loss keeps its cents and its sign (U+2212 minus)", () => {
    expect(formatUsdSigned(0.37)).toBe("+$0.37");
    expect(formatUsdSigned(-0.21)).toBe("−$0.21");
  });

  it("a tiny negative that rounds to zero carries no sign — never a red −$0", () => {
    expect(formatUsdSigned(-0.0001)).toBe("$0.00");
  });

  it("a tiny positive, or zero, that rounds to zero carries no sign — never +$0", () => {
    expect(formatUsdSigned(0.004)).toBe("$0.00");
    expect(formatUsdSigned(0)).toBe("$0.00");
  });

  it("a whole-dollar amount gains cents and thousands separators", () => {
    expect(formatUsdSigned(1300)).toBe("+$1,300.00");
    expect(formatUsdSigned(-1234.6)).toBe("−$1,234.60");
  });

  it("null and non-finite render the em-dash", () => {
    expect(formatUsdSigned(null)).toBe("—");
    expect(formatUsdSigned(Number.NaN)).toBe("—");
  });
});

describe("[169 D-50] signAtCents — the one rounding decision the text sign and the P&L colour read", () => {
  it("reads the sign of the value rounded to cents", () => {
    expect(signAtCents(0.37)).toBe("positive");
    expect(signAtCents(-0.21)).toBe("negative");
    expect(signAtCents(0.005)).toBe("positive");
    expect(signAtCents(-0.0001)).toBe("zero");
    expect(signAtCents(0.004)).toBe("zero");
    expect(signAtCents(0)).toBe("zero");
  });

  it("has no sign for a missing value", () => {
    expect(signAtCents(null)).toBeNull();
    expect(signAtCents(Number.NaN)).toBeNull();
  });
});
