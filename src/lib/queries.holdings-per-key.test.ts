/**
 * Phase 170.4 plan 07 (D-08, D-10): the dashboard payload's holdings contract.
 *
 *   - D-08 "One Key is One Strategy": two live keys on DIFFERENT exchange
 *     accounts that hold one venue:symbol:type keep one row each, and every
 *     total over `holdingsSummary` is the sum over keys.
 *   - D-10: keys that share ONE exchange account count once per day in dollars
 *     (plan 11's `oneKeyPerAccountDay`), so a double-read account is not
 *     summed twice.
 *   - The Scenario fingerprint is a SEPARATE contract: `holdingsFingerprintRows`
 *     keeps every key's rows at its account's newest day, the set
 *     `commit_scenario_batch`'s `contributing` CTE recomputes
 *     (migration 20260929120000). Narrowing it by the winner rule would make
 *     the RPC refuse a commit as `portfolio_fingerprint_stale`.
 *
 * Every figure below is hand-typed, never computed from the fixture.
 */
import { describe, it, expect, vi } from "vitest";

// queries.ts imports the server-only Supabase clients; the derive under test is
// pure, so both are stubbed to nothing (same scaffolding as queries.mandateIsSet).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { derivePhase07Fields } from "./queries";

type HoldingRow = Parameters<typeof derivePhase07Fields>[1][number];

const row = (
  api_key_id: string,
  asof: string,
  updated_at: string,
  symbol: string,
  value_usd: number,
  over: Partial<HoldingRow> = {},
): HoldingRow => ({
  symbol,
  quantity: 1,
  mark_price: value_usd,
  value_usd,
  venue: "binance",
  holding_type: "spot",
  asof,
  api_key_id,
  updated_at,
  side: null,
  entry_price: null,
  unrealized_pnl_usd: null,
  ...over,
});

type Accounts = Record<string, string>;
type Partials = Array<{ api_key_id: string; asof: string }>;

const derive = (
  rows: HoldingRow[],
  accountByKey: Accounts = {},
  partialReads: Partials = [],
) =>
  derivePhase07Fields([], rows, null, partialReads, accountByKey);

const total = (rows: ReadonlyArray<{ value_usd: number }>) =>
  rows.reduce((s, r) => s + r.value_usd, 0);

describe("derivePhase07Fields: one row per key (D-08)", () => {
  it("two keys on different accounts holding one symbol keep one row each and sum to 65000", () => {
    const out = derive(
      [
        row("key-a", "2026-10-02", "2026-10-02T04:00:00+00:00", "BTC", 40000),
        row("key-b", "2026-10-03", "2026-10-03T04:00:00+00:00", "BTC", 25000),
      ],
      { "key-a": "acct-B1", "key-b": "acct-B2" },
    );
    expect(out.holdingsSummary.map((h) => h.api_key_id).sort()).toEqual([
      "key-a",
      "key-b",
    ]);
    expect(total(out.holdingsSummary)).toBe(65000);
  });

  it("with no account map every key is its own account (the default)", () => {
    const out = derive([
      row("key-a", "2026-10-02", "2026-10-02T04:00:00+00:00", "BTC", 40000),
      row("key-b", "2026-10-03", "2026-10-03T04:00:00+00:00", "BTC", 25000),
    ]);
    expect(out.holdingsSummary).toHaveLength(2);
    expect(total(out.holdingsSummary)).toBe(65000);
  });

  it("within one key two rows of one venue:symbol:type still yield one row", () => {
    const out = derive([
      row("key-a", "2026-10-03", "2026-10-03T04:00:00+00:00", "BTC", 30000),
      row("key-a", "2026-10-03", "2026-10-03T04:00:00+00:00", "BTC", 30000),
    ]);
    expect(out.holdingsSummary).toHaveLength(1);
    expect(total(out.holdingsSummary)).toBe(30000);
  });
});

describe("derivePhase07Fields: one key per account-day in dollars (D-10)", () => {
  const sameAccount: Accounts = { "key-a": "acct-D", "key-b": "acct-D" };
  const rows = () => [
    row("key-a", "2026-10-11", "2026-10-11T04:00:05.123456+00:00", "BTC", 30000),
    row("key-a", "2026-10-11", "2026-10-11T04:00:05.123456+00:00", "SOL-PERP", 0, {
      holding_type: "derivative",
      side: "long",
      unrealized_pnl_usd: 400,
    }),
    row("key-b", "2026-10-11", "2026-10-11T04:02:10.5Z", "BTC", 30000),
    row("key-b", "2026-10-11", "2026-10-11T04:02:10.5Z", "ETH", 5000),
  ];

  it("a same-account same-day pair counts once per type: the later spot-only poll's rows, 35000, and the earlier key's SOL-PERP", () => {
    const out = derive(rows(), sameAccount);
    expect(out.holdingsSummary.map((h) => `${h.api_key_id}:${h.symbol}`).sort()).toEqual([
      "key-a:SOL-PERP",
      "key-b:BTC",
      "key-b:ETH",
    ]);
    // SOL-PERP carries value_usd 0 (its equity is the 400 unrealised P&L).
    expect(total(out.holdingsSummary)).toBe(35000);
    expect(
      out.holdingsSummary.find((h) => h.symbol === "SOL-PERP")?.unrealized_pnl_usd,
    ).toBe(400);
  });

  it("a later complete poll still wins both types: key-b's spot and derivative rows only", () => {
    const out = derive(
      [
        ...rows(),
        row("key-b", "2026-10-11", "2026-10-11T04:02:10.5Z", "SOL-PERP", 0, {
          holding_type: "derivative",
          side: "long",
          unrealized_pnl_usd: 450,
        }),
      ],
      sameAccount,
    );
    expect(out.holdingsSummary.map((h) => `${h.api_key_id}:${h.symbol}`).sort()).toEqual([
      "key-b:BTC",
      "key-b:ETH",
      "key-b:SOL-PERP",
    ]);
    expect(total(out.holdingsSummary)).toBe(35000);
  });

  it("the fingerprint rows keep EVERY contributing key's tokens (the RPC's contributing set)", () => {
    const out = derive(rows(), sameAccount);
    expect(
      (out.holdingsFingerprintRows ?? []).map((r) => `${r.symbol}:${r.venue}:${r.holding_type}`).sort(),
    ).toEqual([
      "BTC:binance:spot",
      "BTC:binance:spot",
      "ETH:binance:spot",
      "SOL-PERP:binance:derivative",
    ]);
  });

  it("the fingerprint rows carry symbol, venue and holding_type only", () => {
    const out = derive(rows(), sameAccount);
    for (const r of out.holdingsFingerprintRows ?? []) {
      expect(Object.keys(r).sort()).toEqual(["holding_type", "symbol", "venue"]);
    }
  });

  it("the partial-read note names every key that still holds a row in the summary", () => {
    const out = derive(rows(), sameAccount, [
      { api_key_id: "key-a", asof: "2026-10-11" },
      { api_key_id: "key-b", asof: "2026-10-11" },
    ]);
    expect(out.partialPositionReads).toEqual([
      { api_key_id: "key-a", asof: "2026-10-11" },
      { api_key_id: "key-b", asof: "2026-10-11" },
    ]);
  });

  it("a key that wins no type and holds no row in the summary is not named by the partial-read note", () => {
    const spotOnly = [
      row("key-a", "2026-10-11", "2026-10-11T04:00:05Z", "BTC", 30000),
      row("key-b", "2026-10-11", "2026-10-11T04:02:10Z", "BTC", 30000),
      row("key-b", "2026-10-11", "2026-10-11T04:02:10Z", "ETH", 5000),
    ];
    const out = derive(spotOnly, sameAccount, [
      { api_key_id: "key-a", asof: "2026-10-11" },
      { api_key_id: "key-b", asof: "2026-10-11" },
    ]);
    expect(total(out.holdingsSummary)).toBe(35000);
    expect(out.partialPositionReads).toEqual([{ api_key_id: "key-b", asof: "2026-10-11" }]);
  });

  it("an empty book yields empty fingerprint rows", () => {
    expect(derive([]).holdingsFingerprintRows).toEqual([]);
  });

  it("a row without a parseable updated_at fails loud rather than being treated as a tie", () => {
    const bad = [
      row("key-a", "2026-10-11", "not-a-timestamp", "BTC", 1),
    ];
    expect(() => derive(bad)).toThrow(/updated_at/);
  });
});
