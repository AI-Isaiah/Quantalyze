import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";

/**
 * Phase 167.1.1.1 plan 02 (D-15, D-16, D-18). The TypeScript half of the
 * matcher's AUM basis pin. The Python helper `holding_equity_contribution`
 * (analytics-service/services/holding_equity.py) cannot import TypeScript, so
 * both runtimes replay ONE hand-typed fixture and must give its numbers.
 *
 * `expected_ts` is what `holdingEquityContribution` (src/lib/queries.ts) AND
 * its lockstep client copy `holdingEquityContributionLocal` return. The Python
 * expectation (`expected_py`) differs only on the D-18 case and is asserted by
 * pytest, not here.
 */

// queries.ts pulls in @/lib/audit, which imports "server-only" — that throws
// under vitest+jsdom. Same seam as getMyAllocationDashboard.scenario.test.ts.
vi.mock("server-only", () => ({}));

import { holdingEquityContribution, type MyAllocationDashboardPayload } from "./queries";
import { holdingEquityContributionLocal } from "@/app/(dashboard)/allocations/lib/live-holdings-summary";

type Holding = MyAllocationDashboardPayload["holdingsSummary"][number];
type Sentinel = { nonfinite: "NaN" | "Infinity" | "-Infinity" };
type FixtureValue = number | string | boolean | null | Sentinel;

interface Case {
  name: string;
  holding_type: "spot" | "derivative";
  value_usd: FixtureValue;
  unrealized_pnl_usd: FixtureValue;
  expected_ts: number;
  expected_py: number | null;
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
    join(process.cwd(), "analytics-service/tests/fixtures/holding_equity_contribution_cases.json"),
    "utf8",
  ),
) as { cases: Case[] };

/** A full holding; the case's three fields override the defaults. The cast is the
 *  point: a case feeds a string or a bool where the type says number, because the
 *  function must read it exactly as `Number.isFinite` does. */
function holdingFor(c: Case): Holding {
  return {
    symbol: "SYM",
    venue: "bybit",
    api_key_id: "key-a",
    quantity: 1,
    mark_price_usd: 100,
    side: c.holding_type === "derivative" ? "long" : "flat",
    entry_price: null,
    holding_type: c.holding_type,
    value_usd: decode(c.value_usd),
    unrealized_pnl_usd: decode(c.unrealized_pnl_usd),
  } as unknown as Holding;
}

describe("holdingEquityContribution — shared fixture replay (167.1.1.1 D-16)", () => {
  it("reads the fixture", () => {
    expect(SPEC.cases.length).toBeGreaterThan(0);
  });

  for (const c of SPEC.cases) {
    it(`${c.name} — holdingEquityContribution`, () => {
      // Object.is semantics: a -0 must not hide behind a 0.
      expect(holdingEquityContribution(holdingFor(c))).toBe(c.expected_ts);
    });
    it(`${c.name} — holdingEquityContributionLocal (lockstep copy)`, () => {
      expect(holdingEquityContributionLocal(holdingFor(c))).toBe(c.expected_ts);
    });
  }
});
