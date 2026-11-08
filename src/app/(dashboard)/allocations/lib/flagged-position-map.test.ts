/**
 * Phase 198 plan 12 (C9, D-02, LEAN-06): a Bridge flag is keyed per scope ref
 * (`holding:venue:symbol:type`) while Holdings rows are per API key
 * (`${ref}#${api_key_id}`). So one flag must reach EVERY key's row of its ref and
 * no row of another venue, symbol or type, and a flag with no rendered row must
 * come back as unmatched so it is shown elsewhere. It must never vanish.
 */
import { describe, it, expect } from "vitest";
import { mapFlagsToRows, refOfRowId } from "./flagged-position-map";
import type { FlaggedHolding } from "./holding-outcome-adapter";

const flag = (over: Partial<FlaggedHolding> = {}): FlaggedHolding => ({
  venue: "binance",
  symbol: "BTC",
  holding_type: "spot",
  value_usd: 40_000,
  top_candidate_strategy_id: "cand-1",
  top_candidate_name: "Candidate",
  top_candidate_composite: 70,
  breach_reasons: ["max_weight"],
  ...over,
});

const ROWS = [
  "holding:binance:BTC:spot#k1",
  "holding:binance:BTC:spot#k2",
  "holding:okx:BTC:spot#k1",
  "holding:binance:BTC:derivative#k1",
];

describe("refOfRowId", () => {
  it("splits at the last #", () => {
    expect(refOfRowId("holding:binance:BTC:spot#k1")).toBe("holding:binance:BTC:spot");
    expect(refOfRowId("holding:binance:A#B:spot#k1")).toBe("holding:binance:A#B:spot");
  });
  it("returns an id with no # unchanged", () => {
    expect(refOfRowId("holding:binance:BTC:spot")).toBe("holding:binance:BTC:spot");
  });
});

describe("mapFlagsToRows", () => {
  it("maps one flag to every key's row of its ref and to no other row", () => {
    const f = flag();
    const { flagByRowId, unmatched } = mapFlagsToRows([f], ROWS);
    expect([...flagByRowId.keys()].sort()).toEqual([
      "holding:binance:BTC:spot#k1",
      "holding:binance:BTC:spot#k2",
    ]);
    expect(flagByRowId.get("holding:binance:BTC:spot#k1")).toBe(f);
    expect(flagByRowId.get("holding:binance:BTC:spot#k2")).toBe(f);
    expect(flagByRowId.has("holding:okx:BTC:spot#k1")).toBe(false);
    expect(flagByRowId.has("holding:binance:BTC:derivative#k1")).toBe(false);
    expect(unmatched).toEqual([]);
  });

  it("returns a flag with no row in unmatched", () => {
    const sol = flag({ symbol: "SOL" });
    const { flagByRowId, unmatched } = mapFlagsToRows([sol], ROWS);
    expect(unmatched).toEqual([sol]);
    expect(flagByRowId.size).toBe(0);
  });

  it("returns empty results for no flags", () => {
    const { flagByRowId, unmatched } = mapFlagsToRows([], ROWS);
    expect(flagByRowId.size).toBe(0);
    expect(unmatched).toEqual([]);
  });

  it("depends only on the ids passed: a flag whose every row is left out is unmatched", () => {
    const f = flag();
    const rendered = ROWS.filter((r) => !r.startsWith("holding:binance:BTC:spot#"));
    const { flagByRowId, unmatched } = mapFlagsToRows([f], rendered);
    expect(unmatched).toEqual([f]);
    expect(flagByRowId.size).toBe(0);
  });

  it("splits matched and unmatched flags independently", () => {
    const btc = flag();
    const deriv = flag({ holding_type: "derivative" });
    const sol = flag({ symbol: "SOL" });
    const { flagByRowId, unmatched } = mapFlagsToRows([btc, deriv, sol], ROWS);
    expect(flagByRowId.get("holding:binance:BTC:derivative#k1")).toBe(deriv);
    expect(unmatched).toEqual([sol]);
  });
});
