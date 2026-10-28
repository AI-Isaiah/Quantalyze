import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Phase 167.2.1.1.1.1 plan 09 (D-07, UI-SPEC U-06). The TypeScript half of the
 * stored price-gap pin. The Python twin `is_price_gap_holding`
 * (analytics-service/services/holding_equity.py) cannot import TypeScript, so
 * both runtimes replay ONE hand-typed fixture and must return its single
 * `expected_gap` for every case. That is what keeps the refresh (which holds a
 * gap row's last price) and the UI (which labels it unpriced) from reading
 * "gap" two ways.
 */

import { holdingIsPriceGap, type HoldingPriceGapInput } from "./holding-equity";

type Sentinel = { nonfinite: "NaN" | "Infinity" | "-Infinity" };
type FixtureValue = number | string | boolean | null | Sentinel;

interface Case {
  name: string;
  holding_type: "spot" | "derivative";
  quantity: FixtureValue;
  /** Absent in the fixture is the ABSENT mark: the key is omitted, not null. */
  mark_price?: FixtureValue;
  expected_gap: boolean;
}

const NONFINITE: Record<Sentinel["nonfinite"], number> = {
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  "-Infinity": Number.NEGATIVE_INFINITY,
};

function decode(value: FixtureValue): unknown {
  if (value !== null && typeof value === "object") return NONFINITE[value.nonfinite];
  return value;
}

const SPEC = JSON.parse(
  readFileSync(
    join(process.cwd(), "analytics-service/tests/fixtures/holding_price_gap_cases.json"),
    "utf8",
  ),
) as { cases: Case[] };

/** A holding row; the fixture's DB column `mark_price` maps to the dashboard
 *  field `mark_price_usd`, and an absent mark stays absent. The cast is the
 *  point: a case feeds a string or a bool where the type says number, because
 *  the rule must read it exactly as `Number.isFinite` does. */
function holdingFor(c: Case): HoldingPriceGapInput {
  const row: Record<string, unknown> = {
    holding_type: c.holding_type,
    quantity: decode(c.quantity),
  };
  if ("mark_price" in c) row.mark_price_usd = decode(c.mark_price as FixtureValue);
  return row as unknown as HoldingPriceGapInput;
}

describe("holdingIsPriceGap — shared fixture replay (167.2.1.1.1.1 D-07)", () => {
  it("reads the fixture: 16 hand-typed cases", () => {
    expect(SPEC.cases.length).toBe(16);
  });

  it("every case carries one boolean expected_gap", () => {
    for (const c of SPEC.cases) expect(typeof c.expected_gap, c.name).toBe("boolean");
  });

  for (const c of SPEC.cases) {
    it(`${c.name} — holdingIsPriceGap is ${c.expected_gap}`, () => {
      expect(holdingIsPriceGap(holdingFor(c))).toBe(c.expected_gap);
    });
  }
});
