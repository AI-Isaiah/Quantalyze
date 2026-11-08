import { describe, expect, it } from "vitest";
import { exposureSnapshotFromHoldings } from "./exposure-snapshot";

/**
 * Phase 170.4 plan 01 (D-01, D-08) — the Exposure card's "what I hold now" is
 * built from the dashboard payload's per-key holdings rows, the same array the
 * Holdings and Open Positions tables split by `holding_type`. Every expected
 * total below is a hand-typed literal, never a sum computed by the code under
 * test.
 */

type Row = Parameters<typeof exposureSnapshotFromHoldings>[0][number];

function row(over: Partial<Row> & Pick<Row, "symbol" | "value_usd">): Row {
  return {
    api_key_id: "key-deribit",
    venue: "deribit",
    holding_type: "derivative",
    side: "long",
    asof: "2026-10-03",
    ...over,
  };
}

describe("exposureSnapshotFromHoldings", () => {
  it("builds the 2026-10-03 PROD Deribit book: 3 slices, 185100 gross, 85100 net (short negated)", () => {
    const snap = exposureSnapshotFromHoldings([
      row({ symbol: "BTC-PERP", side: "long", value_usd: 100000 }),
      row({ symbol: "ETH-PERP", side: "short", value_usd: 50000 }),
      row({ symbol: "BTC-27DEC26-60000-C", side: "long", value_usd: 35100 }),
    ]);
    expect(snap).not.toBeNull();
    expect(snap!.slices).toHaveLength(3);
    expect(snap!.totalGrossUsd).toBe(185100);
    expect(snap!.totalNetUsd).toBe(85100);
    expect(snap!.asof).toBe("2026-10-03");
    expect(snap!.oldestAsof).toBe("2026-10-03");
    const eth = snap!.slices.find((s) => s.symbol === "ETH-PERP")!;
    expect(eth.valueUsd).toBe(50000);
    expect(eth.signedValueUsd).toBe(-50000);
  });

  it("reads a spot row with a null side as flat, signed value equal to its value", () => {
    const snap = exposureSnapshotFromHoldings([
      row({
        symbol: "BTC",
        holding_type: "spot",
        venue: "binance",
        api_key_id: "key-a",
        side: null,
        value_usd: 40000,
      }),
    ]);
    expect(snap!.slices).toHaveLength(1);
    expect(snap!.slices[0].side).toBe("flat");
    expect(snap!.slices[0].signedValueUsd).toBe(40000);
    expect(snap!.totalNetUsd).toBe(40000);
  });

  it("stamps the newest read day and the oldest one when keys were read on different days", () => {
    const snap = exposureSnapshotFromHoldings([
      row({ symbol: "BTC-PERP", value_usd: 10, asof: "2026-10-01", api_key_id: "key-a" }),
      row({ symbol: "ETH-PERP", value_usd: 20, asof: "2026-10-03", api_key_id: "key-b" }),
    ]);
    expect(snap!.asof).toBe("2026-10-03");
    expect(snap!.oldestAsof).toBe("2026-10-01");
  });

  it("gives a null stamp, never an invented day, when no row carries an asof", () => {
    const snap = exposureSnapshotFromHoldings([
      row({ symbol: "BTC-PERP", value_usd: 10, asof: undefined }),
    ]);
    expect(snap!.asof).toBeNull();
    expect(snap!.oldestAsof).toBeNull();
    expect(snap!.totalGrossUsd).toBe(10);
  });

  it("returns null for an empty book (honest empty, D-P7)", () => {
    expect(exposureSnapshotFromHoldings([])).toBeNull();
  });

  it("D-08: two keys holding one spot BTC on one venue stay two slices, gross 65000", () => {
    const snap = exposureSnapshotFromHoldings([
      row({
        symbol: "BTC",
        holding_type: "spot",
        venue: "binance",
        api_key_id: "key-a",
        side: "flat",
        value_usd: 40000,
      }),
      row({
        symbol: "BTC",
        holding_type: "spot",
        venue: "binance",
        api_key_id: "key-b",
        side: "flat",
        value_usd: 25000,
      }),
    ]);
    expect(snap!.slices).toHaveLength(2);
    expect(snap!.slices.map((s) => s.apiKeyId).sort()).toEqual(["key-a", "key-b"]);
    expect(snap!.totalGrossUsd).toBe(65000);
  });
  describe("ROUTE-08: cash rows are not exposure", () => {
    const spot = (over: Partial<Row> & Pick<Row, "symbol" | "value_usd">) =>
      row({ holding_type: "spot", venue: "binance", api_key_id: "key-a", side: "flat", ...over });

    it("[BTC spot 40000, USDT spot 10000, BTC-PERP short 20000]: no USDT slice, gross 60000, net 20000, cash 10000", () => {
      const snap = exposureSnapshotFromHoldings([
        spot({ symbol: "BTC", value_usd: 40000 }),
        spot({ symbol: "USDT", value_usd: 10000 }),
        row({ symbol: "BTC-PERP", side: "short", value_usd: 20000 }),
      ]);
      expect(snap!.slices.map((s) => s.symbol).sort()).toEqual(["BTC", "BTC-PERP"]);
      expect(snap!.totalGrossUsd).toBe(60000);
      expect(snap!.totalNetUsd).toBe(20000);
      expect(snap!.cashUsd).toBe(10000);
    });

    it("two cash rows of 0 and 0 give cashUsd 0, not null", () => {
      const snap = exposureSnapshotFromHoldings([
        spot({ symbol: "USDT", value_usd: 0 }),
        spot({ symbol: "USDC", value_usd: 0 }),
      ]);
      expect(snap!.cashUsd).toBe(0);
    });

    it("no cash row gives cashUsd null (no fabricated zero)", () => {
      const snap = exposureSnapshotFromHoldings([spot({ symbol: "BTC", value_usd: 40000 })]);
      expect(snap!.cashUsd).toBeNull();
    });

    it("a book of only cash rows is a snapshot, not null: no slices, gross and net 0, the read day kept", () => {
      const snap = exposureSnapshotFromHoldings([
        spot({ symbol: "USDT", value_usd: 7000, asof: "2026-10-02" }),
        spot({ symbol: "USDC", value_usd: 3000, asof: "2026-10-02" }),
      ]);
      expect(snap).not.toBeNull();
      expect(snap!.slices).toEqual([]);
      expect(snap!.totalGrossUsd).toBe(0);
      expect(snap!.totalNetUsd).toBe(0);
      expect(snap!.cashUsd).toBe(10000);
      expect(snap!.asof).toBe("2026-10-02");
    });

    it("a stablecoin-named DERIVATIVE row is not cash (the rule is spot-only)", () => {
      const snap = exposureSnapshotFromHoldings([
        row({ symbol: "USDT", holding_type: "derivative", value_usd: 500 }),
      ]);
      expect(snap!.slices).toHaveLength(1);
      expect(snap!.cashUsd).toBeNull();
    });
  });
});
