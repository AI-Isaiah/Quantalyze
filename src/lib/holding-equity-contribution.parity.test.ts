import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";

/**
 * Phase 167.1.1.1 plan 02 (D-15, D-16, D-18) and Phase 167.1.1.2 D-04 / D-06 /
 * D-08. The TypeScript half of the AUM basis pin. The Python helper
 * `holding_equity_contribution` (analytics-service/services/holding_equity.py)
 * cannot import TypeScript, so both runtimes replay ONE hand-typed fixture and
 * must return its single `expected` for every case. A derivative whose
 * unrealized P&L is null is withheld (null) in both.
 *
 * Three entry points are replayed: the shared function in
 * `src/lib/holding-equity.ts`, the `queries.ts` re-export, and the client alias
 * `holdingEquityContributionLocal`. One more test asserts they are the SAME
 * function object, so a second definition cannot return (D-04).
 */

// queries.ts pulls in @/lib/audit, which imports "server-only" — that throws
// under vitest+jsdom. Same seam as getMyAllocationDashboard.scenario.test.ts.
// Kept while `./queries` is imported below.
vi.mock("server-only", () => ({}));

import { holdingEquityContribution, type HoldingEquityInput } from "./holding-equity";
import { holdingEquityContribution as fromQueries } from "./queries";
import { holdingEquityContributionLocal } from "@/app/(dashboard)/allocations/lib/live-holdings-summary";

type Holding = HoldingEquityInput;
type Sentinel = { nonfinite: "NaN" | "Infinity" | "-Infinity" };
type FixtureValue = number | string | boolean | null | Sentinel;

interface Case {
  name: string;
  holding_type: "spot" | "derivative";
  value_usd: FixtureValue;
  unrealized_pnl_usd: FixtureValue;
  expected: number | null;
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

/** A holding; the case's three fields are all the function reads. The cast is the
 *  point: a case feeds a string or a bool where the type says number, because the
 *  function must read it exactly as `Number.isFinite` does. */
function holdingFor(c: Case): Holding {
  return {
    holding_type: c.holding_type,
    value_usd: decode(c.value_usd),
    unrealized_pnl_usd: decode(c.unrealized_pnl_usd),
  } as unknown as Holding;
}

describe("holdingEquityContribution — shared fixture replay (167.1.1.2 D-06)", () => {
  it("reads the fixture", () => {
    expect(SPEC.cases.length).toBeGreaterThan(0);
  });

  it("is ONE definition: the queries.ts export and the client alias are the shared function (D-04)", () => {
    expect(fromQueries).toBe(holdingEquityContribution);
    expect(holdingEquityContributionLocal).toBe(holdingEquityContribution);
  });

  for (const c of SPEC.cases) {
    it(`${c.name} — holdingEquityContribution`, () => {
      // Object.is semantics: a -0 must not hide behind a 0, and null is not 0.
      expect(holdingEquityContribution(holdingFor(c))).toBe(c.expected);
    });
    it(`${c.name} — queries.ts re-export`, () => {
      expect(fromQueries(holdingFor(c))).toBe(c.expected);
    });
    it(`${c.name} — holdingEquityContributionLocal (client alias)`, () => {
      expect(holdingEquityContributionLocal(holdingFor(c) as never)).toBe(c.expected);
    });
  }

  it("a derivative with the P&L key ABSENT is withheld like null (loose equality)", () => {
    expect(holdingEquityContribution({ holding_type: "derivative", value_usd: 1000 })).toBeNull();
  });
});
