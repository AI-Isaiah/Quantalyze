/**
 * Phase 243 plan 03 (DBACC-01 half a) - the by-basis select fragment is an exact pinned set, and
 * the rebuild rule answers the writer-shaped object for every writer-shaped row.
 *
 * The pin compares against `PINNED_BY_BASIS_ALIAS_NAMES`, which is hand-typed and independent of
 * the production literal, so it cannot pass tautologically: an extra alias (for example a series
 * array) or a missing one fails here until a person edits both.
 */
import { describe, it, expect } from "vitest";
import { BY_BASIS_ALIASES, BY_BASIS_BASES, rebuildMetricsJsonByBasis } from "./by-basis-projection";
import { storedCashHeadlineGate } from "./headline-basis";
import { hasBasisHeadline } from "./basis-metrics";
import { PINNED_BY_BASIS_ALIAS_NAMES, byBasisAliasRow } from "@/lib/test-helpers/by-basis-alias-row";

const SEVEN = {
  cumulative_return: 0.05,
  volatility: 0.12,
  max_drawdown: -0.04,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};

const entries = BY_BASIS_ALIASES.split(", ").map((e) => {
  const [name, path] = e.split(":");
  return { name, path };
});

describe("BY_BASIS_ALIASES: the exact-set pin", () => {
  it("names exactly the 21 hand-typed aliases, in order: it fails on an extra or a missing key", () => {
    expect(entries.map((e) => e.name)).toEqual([...PINNED_BY_BASIS_ALIAS_NAMES]);
    expect(PINNED_BY_BASIS_ALIAS_NAMES).toHaveLength(21);
    expect(new Set(PINNED_BY_BASIS_ALIAS_NAMES).size).toBe(21);
  });

  it("every entry reads metrics_json_by_basis-><basis>-><key> and its name says so", () => {
    for (const { name, path } of entries) {
      const m = /^metrics_json_by_basis->([a-z_]+)->([a-z_]+)$/.exec(path);
      expect(m, `bad path in ${name}`).not.toBeNull();
      expect(BY_BASIS_BASES as readonly string[]).toContain(m![1]);
      expect(name).toBe(`by_basis_${m![1]}_${m![2]}`);
    }
  });

  it("uses jsonb arrows only and never projects the column whole", () => {
    expect(BY_BASIS_ALIASES).not.toContain("->>");
    expect(BY_BASIS_ALIASES).not.toMatch(/metrics_json_by_basis(?!->)/);
    expect(BY_BASIS_ALIASES).not.toMatch(/metrics_json(?!->|_by_basis->)/);
  });
});

describe("rebuildMetricsJsonByBasis: parity with the raw column", () => {
  it("a basis present with all seven finite values is rebuilt verbatim", () => {
    expect(rebuildMetricsJsonByBasis(byBasisAliasRow({ cash_settlement: SEVEN }))).toEqual({ cash_settlement: SEVEN });
  });

  it("an absent basis is absent in the result", () => {
    const out = rebuildMetricsJsonByBasis(byBasisAliasRow({ cash_settlement: SEVEN }));
    expect(out).not.toHaveProperty("mark_to_market");
    expect(out).not.toHaveProperty("smoothed_mtm");
  });

  it("cumulative_return null with another key non-null is emitted, so hasBasisHeadline stays false", () => {
    const out = rebuildMetricsJsonByBasis(
      byBasisAliasRow({ cash_settlement: { ...SEVEN, cumulative_return: null } }),
    );
    expect(out?.cash_settlement).toEqual({ ...SEVEN, cumulative_return: null });
    expect(hasBasisHeadline(out?.cash_settlement)).toBe(false);
  });

  it("DOCUMENTED DIVERGENCE: a present basis whose seven values are all null is omitted (PROD census: 0 rows)", () => {
    const allNull = Object.fromEntries(Object.keys(SEVEN).map((k) => [k, null]));
    expect(rebuildMetricsJsonByBasis(byBasisAliasRow({ cash_settlement: allNull }))).toBeUndefined();
    const out = rebuildMetricsJsonByBasis(byBasisAliasRow({ cash_settlement: allNull, mark_to_market: SEVEN }));
    expect(out).toEqual({ mark_to_market: SEVEN });
  });

  it("a string value becomes null (a text alias would never be a KPI)", () => {
    const out = rebuildMetricsJsonByBasis(
      byBasisAliasRow({ cash_settlement: { ...SEVEN, sharpe: "1.4" } }),
    );
    expect(out?.cash_settlement.sharpe).toBeNull();
    expect(out?.cash_settlement.cagr).toBe(SEVEN.cagr);
  });

  it("all bases absent, a null row and an undefined row give undefined", () => {
    expect(rebuildMetricsJsonByBasis(byBasisAliasRow({}))).toBeUndefined();
    expect(rebuildMetricsJsonByBasis(byBasisAliasRow(null))).toBeUndefined();
    expect(rebuildMetricsJsonByBasis(null)).toBeUndefined();
    expect(rebuildMetricsJsonByBasis(undefined)).toBeUndefined();
  });

  it("a non-finite number (NaN, Infinity) becomes null", () => {
    const out = rebuildMetricsJsonByBasis(
      byBasisAliasRow({ cash_settlement: { ...SEVEN, volatility: Number.NaN, calmar: Number.POSITIVE_INFINITY } }),
    );
    expect(out?.cash_settlement.volatility).toBeNull();
    expect(out?.cash_settlement.calmar).toBeNull();
  });
});

describe("rebuildMetricsJsonByBasis: round trip", () => {
  it("one basis round-trips to the writer-shaped object", () => {
    const x = { mark_to_market: SEVEN };
    expect(rebuildMetricsJsonByBasis(byBasisAliasRow(x))).toEqual(x);
  });

  it("three bases round-trip to the writer-shaped object", () => {
    const x = {
      cash_settlement: SEVEN,
      mark_to_market: { ...SEVEN, cagr: 0.2, calmar: null },
      smoothed_mtm: { ...SEVEN, sharpe: -0.5 },
    };
    expect(rebuildMetricsJsonByBasis(byBasisAliasRow(x))).toEqual(x);
  });

  it("keys outside the seven (a series array) never survive the round trip: the point of the projection", () => {
    const x = { cash_settlement: { ...SEVEN, returns_series: [{ date: "2024-01-02", value: 0.01 }] } };
    expect(rebuildMetricsJsonByBasis(byBasisAliasRow(x))).toEqual({ cash_settlement: SEVEN });
  });
});

describe("storedCashHeadlineGate over the rebuilt object", () => {
  it("answers raw_cash_settlement for a cash-bearing row, exactly as for the raw object", () => {
    const raw = { cash_settlement: SEVEN };
    const rebuilt = rebuildMetricsJsonByBasis(byBasisAliasRow(raw));
    const row = { ...SEVEN };
    const viaRaw = storedCashHeadlineGate(row, raw, "complete");
    const viaRebuilt = storedCashHeadlineGate(row, rebuilt, "complete");
    expect(viaRaw).toEqual({ applicable: false, reason: "raw_cash_settlement" });
    expect(viaRebuilt).toEqual(viaRaw);
  });

  it("applies for a row with no cash object, raw or rebuilt", () => {
    const raw = { mark_to_market: SEVEN };
    const rebuilt = rebuildMetricsJsonByBasis(byBasisAliasRow(raw));
    expect(storedCashHeadlineGate({ ...SEVEN }, rebuilt, "complete")).toEqual(
      storedCashHeadlineGate({ ...SEVEN }, raw, "complete"),
    );
  });
});
