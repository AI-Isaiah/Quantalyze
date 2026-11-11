/**
 * Phase 201 plan 16 (D-01, T-201-21): the discovery column tooltips read the registry and say the
 * same words they said before the move.
 *
 * WHY THE ORACLE IS TYPED BY HAND. The tooltips moved out of `discovery-columns.ts` into the
 * glossary registry. An oracle built by importing either module's strings would pass whatever
 * those strings became, so a registry edit that changed what a reader sees would go unnoticed.
 * Every literal below was typed from the file at HEAD before the move; a reader of the discovery
 * header must still read exactly these words (UI-SPEC "Discovery context", rule 6).
 *
 * WHY THESE TESTS CAN FAIL. Change one word of a registry `discovery` context and the literal arm
 * names the column whose tooltip drifted. Delete a column's registry link and the second arm
 * fails. Re-introduce a private copy of a tooltip and the two arms disagree.
 */

import { describe, it, expect } from "vitest";
import { DISCOVERY_COLUMNS } from "./discovery-columns";
import { termDefinition, type TermKey } from "@/lib/glossary";

const BASIS = "From the first return day, or from the last break in the record.";

/** Every column's tooltip as it read at HEAD; `undefined` for Strategy, which has none. */
const HEAD_TOOLTIPS: Record<string, string | undefined> = {
  name: undefined,
  track: "How long the record is, in whole months. Counted over the days its returns cover.",
  cumulative_return: `Total return over the whole record. ${BASIS}`,
  cagr: `Compound annual growth rate over the whole record. ${BASIS}`,
  sharpe: `Annualized return divided by annualized volatility over the whole record. ${BASIS}`,
  max_drawdown: `The largest fall from a peak over the whole record. ${BASIS}`,
  volatility:
    "How much daily returns vary, annualized over the whole record. It is never negative, so it carries no sign.",
  six_month_return:
    "Return over the 182 calendar days that end on the record's last day.",
  aum: "Assets under management as the manager states it. It is not measured from the exchange.",
  sparkline_returns: "Cumulative return over the whole record.",
  sparkline_drawdown: "Distance below the previous peak over the whole record.",
};

/** The registry key each discovery column reads (typed independently of the module under test). */
const TERM_OF: Record<string, TermKey | undefined> = {
  name: undefined,
  track: "track",
  cumulative_return: "return_full",
  cagr: "cagr",
  sharpe: "sharpe",
  max_drawdown: "max_drawdown",
  volatility: "volatility",
  six_month_return: "return_6m",
  aum: "aum",
  sparkline_returns: "return_curve",
  sparkline_drawdown: "underwater",
};

describe("discovery column tooltips (D-01)", () => {
  it("the oracle lists every column, so a new column cannot slip past unpinned", () => {
    expect(DISCOVERY_COLUMNS.map((c) => c.key).sort()).toEqual(
      Object.keys(HEAD_TOOLTIPS).sort(),
    );
  });

  for (const col of DISCOVERY_COLUMNS) {
    it(`${col.key}: the tooltip reads exactly the words it read at HEAD`, () => {
      expect(col.tooltip).toBe(HEAD_TOOLTIPS[col.key]);
    });

    it(`${col.key}: the tooltip is the registry's discovery definition`, () => {
      const term = TERM_OF[col.key];
      if (!term) {
        expect(col.tooltip).toBeUndefined();
        expect(col.term).toBeUndefined();
        return;
      }
      expect(col.term).toBe(term);
      expect(col.tooltip).toBe(termDefinition(term, "discovery"));
    });
  }
});
