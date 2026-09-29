/**
 * Phase 167.1.2 plan 15 (item 8, D-16). The pure filter behind Open Positions:
 * each key keeps its rows at its own latest asof. A key closing a position
 * before its latest poll must see that position leave; a key that did not
 * poll on the allocator's latest day must keep its own rows.
 */
import { describe, expect, it } from "vitest";
import { latestHoldingsPerKey } from "./latest-holdings-per-key";

type Row = { api_key_id: string; asof: string; symbol: string };
const r = (api_key_id: string, asof: string, symbol: string): Row => ({
  api_key_id,
  asof,
  symbol,
});
const ids = (rows: Row[]) =>
  rows.map((x) => `${x.api_key_id}:${x.asof}:${x.symbol}`);

describe("latestHoldingsPerKey (D-16)", () => {
  it("empty input returns an empty list", () => {
    expect(latestHoldingsPerKey([])).toEqual([]);
  });

  it("one key: only the rows at its latest asof survive", () => {
    const rows = [
      r("key-a", "2026-09-26", "BTC"),
      r("key-a", "2026-09-26", "ETH"),
      r("key-a", "2026-09-27", "ETH"),
    ];
    expect(ids(latestHoldingsPerKey(rows))).toEqual(["key-a:2026-09-27:ETH"]);
  });

  it("several keys: each keeps its own latest asof, not the allocator-wide one", () => {
    const rows = [
      r("key-a", "2026-09-27", "ETH"),
      r("key-a", "2026-09-26", "BTC"),
      r("key-b", "2026-09-25", "SOL"),
      r("key-b", "2026-09-24", "DOGE"),
      r("key-c", "2026-09-20", "XRP"),
    ];
    expect(ids(latestHoldingsPerKey(rows))).toEqual([
      "key-a:2026-09-27:ETH",
      "key-b:2026-09-25:SOL",
      "key-c:2026-09-20:XRP",
    ]);
  });

  it("ascending and descending input give the same rows (ordering is not trusted)", () => {
    const asc = [
      r("key-a", "2026-09-25", "BTC"),
      r("key-b", "2026-09-25", "SOL"),
      r("key-a", "2026-09-26", "ETH"),
      r("key-a", "2026-09-27", "ETH"),
      r("key-a", "2026-09-27", "LINK"),
    ];
    const desc = [...asc].reverse();
    const sorted = (rows: Row[]) => ids(latestHoldingsPerKey(rows)).sort();
    expect(sorted(asc)).toEqual([
      "key-a:2026-09-27:ETH",
      "key-a:2026-09-27:LINK",
      "key-b:2026-09-25:SOL",
    ]);
    expect(sorted(desc)).toEqual(sorted(asc));
  });

  it("every row sharing a key's latest asof is kept, in input order", () => {
    const rows = [
      r("key-a", "2026-09-27", "LINK"),
      r("key-a", "2026-09-26", "BTC"),
      r("key-a", "2026-09-27", "ETH"),
    ];
    expect(ids(latestHoldingsPerKey(rows))).toEqual([
      "key-a:2026-09-27:LINK",
      "key-a:2026-09-27:ETH",
    ]);
  });

  it("extra row fields pass through untouched", () => {
    const rows = [{ api_key_id: "key-a", asof: "2026-09-27", value_usd: 42 }];
    expect(latestHoldingsPerKey(rows)).toEqual(rows);
  });
});
