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
});
