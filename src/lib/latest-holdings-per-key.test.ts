/**
 * Phase 167.1.2 plan 15 (item 8, D-16). The pure filter behind Open Positions:
 * each key keeps its rows at its own latest asof. A key closing a position
 * before its latest poll must see that position leave; a key that did not
 * poll on the allocator's latest day must keep its own rows.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fetchLatestHoldingsPerKey,
  HOLDINGS_ROW_CAP,
  latestHoldingsPerKey,
  NATIVE_UNPRICED_KIND_PREFIX,
  fetchNativeUnpricedDays,
  nativeUnpricedDay,
} from "./latest-holdings-per-key";

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

// ---------------------------------------------------------------------------
// fetchLatestHoldingsPerKey: the bounded read. A hand-rolled client answers
// each step from `keys` / `holdings`, honouring eq, order and limit, so the
// arms exercise the real three-step logic. `fail` injects an error into the
// step whose table and select match.
// ---------------------------------------------------------------------------
type HoldingDb = { allocator_id: string; api_key_id: string; asof: string; symbol: string };
type Fail = { table: string; select: string; message: string };
type KeyDb = {
  id: string;
  user_id: string;
  exchange?: string;
  venue_account_id?: string | null;
  account_share_kind?: string | null;
  account_shared_with_api_key_id?: string | null;
};
/** One `allocator.holdings.sync_completed` audit row, as the poll writes it. */
type AuditDb = {
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
  // The fake has no JSON operators: the `metadata->>final_status` filter
  // reads this flattened copy, which `poll()` keeps equal to the metadata's.
  "metadata->>final_status": unknown;
};

function fakeClient(
  keys: KeyDb[],
  holdings: HoldingDb[],
  fail?: Fail,
  audit: AuditDb[] = [],
  derived: Array<Record<string, unknown>> = [],
) {
  return {
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      let likePrefix: { column: string; prefix: string } | null = null;
      let select = "";
      let order: { column: string; ascending: boolean } | null = null;
      let limit: number | null = null;
      const chain = {
        select(c: string) {
          select = c;
          return chain;
        },
        eq(c: string, v: unknown) {
          eqs.push([c, v]);
          return chain;
        },
        like(c: string, pattern: string) {
          likePrefix = { column: c, prefix: pattern.replace(/%$/, "") };
          return chain;
        },
        order(c: string, o: { ascending: boolean }) {
          order = { column: c, ascending: o.ascending };
          return chain;
        },
        limit(n: number) {
          limit = n;
          return chain;
        },
        then(resolve: (v: unknown) => void) {
          if (fail && fail.table === table && fail.select === select) {
            resolve({ data: null, error: { message: fail.message } });
            return;
          }
          const source = (
            table === "api_keys"
              ? keys
              : table === "audit_log"
                ? audit
                : table === "allocator_equity_derived"
                  ? derived
                  : holdings
          ) as Array<Record<string, unknown>>;
          let rows = source.filter((r) => eqs.every(([c, v]) => r[c] === v));
          if (likePrefix) {
            const { column, prefix } = likePrefix;
            rows = rows.filter((r) => String(r[column]).startsWith(prefix));
          }
          if (order) {
            const { column, ascending } = order;
            rows = [...rows].sort(
              (a, b) =>
                (String(a[column]) < String(b[column]) ? -1 : 1) *
                (ascending ? 1 : -1),
            );
          }
          if (limit !== null) rows = rows.slice(0, limit);
          resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  } as unknown as Parameters<typeof fetchLatestHoldingsPerKey>[0];
}

/** A poll's success event for `keyId` (user-1), as `_emit_audit` records it. */
function poll(
  keyId: string,
  createdAt: string,
  metadata: Record<string, unknown> | null,
): AuditDb {
  return {
    user_id: "user-1",
    action: "allocator.holdings.sync_completed",
    entity_type: "api_key",
    entity_id: keyId,
    created_at: createdAt,
    metadata,
    "metadata->>final_status":
      metadata && typeof metadata.final_status === "string"
        ? metadata.final_status
        : null,
  };
}

const h = (api_key_id: string, asof: string, symbol: string): HoldingDb => ({
  allocator_id: "user-1",
  api_key_id,
  asof,
  symbol,
});
const COLS = "api_key_id, asof, symbol";
const KEY_SELECT =
  "id, exchange, venue_account_id, account_share_kind, account_shared_with_api_key_id";

describe("fetchLatestHoldingsPerKey (D-16, bounded read)", () => {
  it("returns each key's rows at its own latest asof, from an ascending table", async () => {
    const client = fakeClient(
      [
        { id: "key-a", user_id: "user-1" },
        { id: "key-b", user_id: "user-1" },
      ],
      [
        h("key-a", "2026-09-25", "BTC"),
        h("key-a", "2026-09-27", "ETH"),
        h("key-b", "2026-09-24", "SOL"),
        h("key-b", "2026-09-26", "XRP"),
      ],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.error).toBeNull();
    expect(ids(res.data as Row[]).sort()).toEqual([
      "key-a:2026-09-27:ETH",
      "key-b:2026-09-26:XRP",
    ]);
  });

  it("a key with no holdings contributes nothing and is not an error", async () => {
    const client = fakeClient(
      [
        { id: "key-a", user_id: "user-1" },
        { id: "key-empty", user_id: "user-1" },
      ],
      [h("key-a", "2026-09-27", "ETH")],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.error).toBeNull();
    expect(ids(res.data as Row[])).toEqual(["key-a:2026-09-27:ETH"]);
  });

  it("no keys at all is an empty book, not an error", async () => {
    const res = await fetchLatestHoldingsPerKey(fakeClient([], []), "user-1", COLS);
    expect(res).toEqual({ data: [], error: null, partialReads: [] });
  });

  it("another user's keys and rows are never read", async () => {
    const client = fakeClient(
      [
        { id: "key-a", user_id: "user-1" },
        { id: "key-x", user_id: "user-2" },
      ],
      [
        h("key-a", "2026-09-27", "ETH"),
        { allocator_id: "user-2", api_key_id: "key-x", asof: "2026-09-27", symbol: "BTC" },
      ],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[])).toEqual(["key-a:2026-09-27:ETH"]);
  });

  it.each([
    ["the key id read", "api_keys", KEY_SELECT],
    ["a poll-outcome read", "audit_log", "metadata"],
    ["a latest-asof read", "allocator_holdings", "asof"],
    ["a rows read", "allocator_holdings", COLS],
  ])("an error in %s is returned as error, with no partial data", async (_label, table, select) => {
    const client = fakeClient(
      [{ id: "key-a", user_id: "user-1" }],
      [h("key-a", "2026-09-27", "ETH")],
      { table, select, message: "rls denied" },
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res).toEqual({ data: null, error: { message: "rls denied" }, partialReads: [] });
  });

  it("a per-key rows read that reaches the row cap returns a named error, never a partial list", async () => {
    const atCap = Array.from({ length: HOLDINGS_ROW_CAP }, (_, i) =>
      h("key-a", "2026-09-27", `SYM${i}`),
    );
    const client = fakeClient([{ id: "key-a", user_id: "user-1" }], atCap);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe(
      "allocator_holdings per-key read reached the row cap",
    );
  });

  it("one row under the cap is still returned whole", async () => {
    const underCap = Array.from({ length: HOLDINGS_ROW_CAP - 1 }, (_, i) =>
      h("key-a", "2026-09-27", `SYM${i}`),
    );
    const client = fakeClient([{ id: "key-a", user_id: "user-1" }], underCap);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(HOLDINGS_ROW_CAP - 1);
  });

  it("a key id read that reaches the row cap returns a named error", async () => {
    const keys = Array.from({ length: HOLDINGS_ROW_CAP }, (_, i) => ({
      id: `key-${i}`,
      user_id: "user-1",
    }));
    const res = await fetchLatestHoldingsPerKey(fakeClient(keys, []), "user-1", COLS);
    expect(res).toEqual({
      data: null,
      error: { message: "api_keys id read reached the row cap" },
      partialReads: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Review C4 SFH-C4-02 (and the WR-02 not-worse arm). A clean poll that read
// NOTHING writes no holdings row, so the key's latest asof stays on the day
// before its last position closed. The poll's own record of that outcome is
// its `allocator.holdings.sync_completed` audit event (final_status, row_count,
// asof), the same evidence the daily refresh reads (`_polled_empty_since`).
// ---------------------------------------------------------------------------
describe("fetchLatestHoldingsPerKey: a later clean poll supersedes older rows (SFH-C4-02)", () => {
  const deribit = [{ id: "key-d", user_id: "user-1", exchange: "deribit" }];
  const expired = [
    h("key-d", "2026-09-26", "BTC-26SEP26-60000-C"),
    h("key-d", "2026-09-26", "ETH-26SEP26-3000-P"),
  ];

  it("a clean, empty poll after the key's latest rows leaves the key with no current rows", async () => {
    const client = fakeClient(deribit, expired, undefined, [
      poll("key-d", "2026-09-27T04:00:05+00:00", {
        final_status: "complete",
        row_count: 0,
        asof: "2026-09-27",
      }),
    ]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res).toEqual({ data: [], error: null, partialReads: [] });
  });

  it("the newest clean poll decides: an empty poll before a later poll with rows does not hide them", async () => {
    const client = fakeClient(
      deribit,
      [...expired, h("key-d", "2026-09-28", "BTC-PERPETUAL")],
      undefined,
      [
        poll("key-d", "2026-09-27T04:00:05+00:00", {
          final_status: "complete",
          row_count: 0,
          asof: "2026-09-27",
        }),
        poll("key-d", "2026-09-28T04:00:05+00:00", {
          final_status: "complete",
          row_count: 1,
          asof: "2026-09-28",
        }),
      ],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[])).toEqual(["key-d:2026-09-28:BTC-PERPETUAL"]);
  });

  it.each([
    [
      "a poll with warnings (a read failed, so empty proves nothing)",
      { final_status: "complete_with_warnings", row_count: 0, asof: "2026-09-27" },
    ],
    [
      "an event written before the poll recorded its day (no asof)",
      { final_status: "complete", row_count: 0 },
    ],
    [
      "a poll on the rows' own day",
      { final_status: "complete", row_count: 0, asof: "2026-09-26" },
    ],
    [
      "a malformed row_count",
      { final_status: "complete", row_count: "0", asof: "2026-09-27" },
    ],
    ["no metadata at all", null],
  ])("%s keeps the key's latest rows", async (_label, metadata) => {
    const client = fakeClient(deribit, expired, undefined, [
      poll("key-d", "2026-09-27T04:00:05+00:00", metadata),
    ]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[]).sort()).toEqual([
      "key-d:2026-09-26:BTC-26SEP26-60000-C",
      "key-d:2026-09-26:ETH-26SEP26-3000-P",
    ]);
  });

  it("WR-02 not-worse: a clean poll that wrote rows the key no longer owns does not bring back its older rows", async () => {
    // The unique index has no api_key_id, so another key's upsert on the same
    // (venue, symbol, asof) relabels this key's only row of the day. The key's
    // latest asof falls back a day; its poll record says it read on the later day.
    const client = fakeClient(
      [{ id: "key-a", user_id: "user-1", exchange: "binance" }],
      [h("key-a", "2026-09-26", "BTC"), h("key-a", "2026-09-26", "SOL")],
      undefined,
      [
        poll("key-a", "2026-09-27T04:00:05+00:00", {
          final_status: "complete",
          row_count: 1,
          asof: "2026-09-27",
        }),
      ],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res).toEqual({ data: [], error: null, partialReads: [] });
  });

  it("another user's poll events are never read", async () => {
    const foreign = {
      ...poll("key-d", "2026-09-27T04:00:05+00:00", {
        final_status: "complete",
        row_count: 0,
        asof: "2026-09-27",
      }),
      user_id: "user-2",
    };
    const client = fakeClient(deribit, expired, undefined, [foreign]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.data).toHaveLength(2);
  });
});


// ---------------------------------------------------------------------------
// Review C4 SFH-C4-01. Keys that read ONE exchange account (the D-09 account
// identity, `accountIdentityTokens`) are one reading of that account. Only the
// keys holding the account's newest reading contribute rows, so a departed
// key's last poll cannot stand in for a position a live key on the same
// account has since closed.
// ---------------------------------------------------------------------------
describe("fetchLatestHoldingsPerKey: one exchange account, one reading (SFH-C4-01)", () => {
  const departed = {
    id: "key-old",
    user_id: "user-1",
    exchange: "binance",
    venue_account_id: "acct-1",
  };
  const live = {
    id: "key-new",
    user_id: "user-1",
    exchange: "Binance",
    venue_account_id: "acct-1",
  };

  it("a live key's newer reading supersedes a departed key's older rows on the same account", async () => {
    const client = fakeClient(
      [departed, live],
      [h("key-old", "2026-08-31", "BTC-PERP"), h("key-new", "2026-09-29", "ETH-PERP")],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[])).toEqual(["key-new:2026-09-29:ETH-PERP"]);
  });

  it("a live key whose newest clean poll read nothing supersedes them too", async () => {
    const client = fakeClient(
      [departed, live],
      [h("key-old", "2026-08-31", "BTC-PERP"), h("key-new", "2026-09-20", "ETH-PERP")],
      undefined,
      [
        poll("key-new", "2026-09-29T04:00:05+00:00", {
          final_status: "complete",
          row_count: 0,
          asof: "2026-09-29",
        }),
      ],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res).toEqual({ data: [], error: null, partialReads: [] });
  });

  it("a live key that never wrote a row but polled clean and empty supersedes them too", async () => {
    const client = fakeClient(
      [departed, live],
      [h("key-old", "2026-08-31", "BTC-PERP")],
      undefined,
      [
        poll("key-new", "2026-09-29T04:00:05+00:00", {
          final_status: "complete",
          row_count: 0,
          asof: "2026-09-29",
        }),
      ],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res).toEqual({ data: [], error: null, partialReads: [] });
  });

  it("a marker link joins the account when the marked key has no venue id of its own", async () => {
    const marked = {
      id: "key-new",
      user_id: "user-1",
      exchange: "binance",
      venue_account_id: null,
      account_share_kind: "duplicate",
      account_shared_with_api_key_id: "key-old",
    };
    const client = fakeClient(
      [departed, marked],
      [h("key-old", "2026-08-31", "BTC-PERP"), h("key-new", "2026-09-29", "ETH-PERP")],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[])).toEqual(["key-new:2026-09-29:ETH-PERP"]);
  });

  it("a live key that never polled leaves the departed key's rows standing", async () => {
    const client = fakeClient([departed, live], [h("key-old", "2026-08-31", "BTC-PERP")]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[])).toEqual(["key-old:2026-08-31:BTC-PERP"]);
  });

  it("a key whose last reading is OLDER than the departed key's does not supersede it", async () => {
    const client = fakeClient(
      [departed, live],
      [h("key-old", "2026-08-31", "BTC-PERP"), h("key-new", "2026-08-15", "ETH-PERP")],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[])).toEqual(["key-old:2026-08-31:BTC-PERP"]);
  });

  it("keys on DIFFERENT accounts each keep their own latest rows", async () => {
    const other = { ...live, venue_account_id: "acct-2" };
    const client = fakeClient(
      [departed, other],
      [h("key-old", "2026-08-31", "BTC-PERP"), h("key-new", "2026-09-29", "ETH-PERP")],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[]).sort()).toEqual([
      "key-new:2026-09-29:ETH-PERP",
      "key-old:2026-08-31:BTC-PERP",
    ]);
  });

  it("keys with no known account identity are each their own account", async () => {
    const client = fakeClient(
      [
        { id: "key-a", user_id: "user-1", exchange: "binance", venue_account_id: null },
        { id: "key-b", user_id: "user-1", exchange: "binance", venue_account_id: null },
      ],
      [h("key-a", "2026-08-31", "BTC-PERP"), h("key-b", "2026-09-29", "ETH-PERP")],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[]).sort()).toEqual([
      "key-a:2026-08-31:BTC-PERP",
      "key-b:2026-09-29:ETH-PERP",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Review C4 round 2 WR-R2-03 / SFH-R2-02. A key whose rows came from a poll
// that could not read its open positions (`complete_with_warnings` on the
// rows' own day) is named in `partialReads`, with the rows' day. The flag follows the poll
// that WROTE the rows the read returns, never the key's current status: a
// failed poll records `sync_failed` and writes nothing, so the rows and their
// poll's record both stay, and so must the flag.
// ---------------------------------------------------------------------------
describe("fetchLatestHoldingsPerKey: the poll that wrote the rows could not read positions (WR-R2-03)", () => {
  const binance = [{ id: "key-b", user_id: "user-1", exchange: "binance" }];
  const spotOnly = [h("key-b", "2026-09-05", "USDT"), h("key-b", "2026-09-05", "BTC")];
  const partial = poll("key-b", "2026-09-05T04:00:05+00:00", {
    final_status: "complete_with_warnings",
    row_count: 2,
    asof: "2026-09-05",
  });
  const failed = (createdAt: string): AuditDb => ({
    ...poll("key-b", createdAt, { error_kind: "rate_limit", sanitized_message: "429" }),
    action: "allocator.holdings.sync_failed",
  });

  it("a partial poll names the key", async () => {
    const client = fakeClient(binance, spotOnly, undefined, [partial]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.error).toBeNull();
    expect(res.partialReads).toEqual([{ api_key_id: "key-b", asof: "2026-09-05" }]);
  });

  it("a partial poll, then a failed poll: the rows stay and so does the flag", async () => {
    const client = fakeClient(binance, spotOnly, undefined, [
      partial,
      failed("2026-09-06T04:00:05+00:00"),
    ]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[]).sort()).toEqual([
      "key-b:2026-09-05:BTC",
      "key-b:2026-09-05:USDT",
    ]);
    expect(res.partialReads).toEqual([{ api_key_id: "key-b", asof: "2026-09-05" }]);
  });

  it("a later clean poll on the same day read the positions: no flag", async () => {
    const client = fakeClient(binance, [...spotOnly, h("key-b", "2026-09-05", "BTC-PERP")], undefined, [
      partial,
      poll("key-b", "2026-09-05T11:00:00+00:00", {
        final_status: "complete",
        row_count: 3,
        asof: "2026-09-05",
      }),
    ]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.partialReads).toEqual([]);
  });

  it("a later clean poll on a later day: no flag", async () => {
    const client = fakeClient(binance, [...spotOnly, h("key-b", "2026-09-06", "BTC-PERP")], undefined, [
      partial,
      poll("key-b", "2026-09-06T04:00:05+00:00", {
        final_status: "complete",
        row_count: 1,
        asof: "2026-09-06",
      }),
    ]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[])).toEqual(["key-b:2026-09-06:BTC-PERP"]);
    expect(res.partialReads).toEqual([]);
  });

  it("a partial poll on a day other than the rows' day did not write them: no flag", async () => {
    // A partial poll that read no spot row either writes nothing, so the key's
    // rows are still an older, complete poll's.
    const client = fakeClient(binance, spotOnly, undefined, [
      poll("key-b", "2026-09-06T04:00:05+00:00", {
        final_status: "complete_with_warnings",
        row_count: 0,
        asof: "2026-09-06",
      }),
    ]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.data).toHaveLength(2);
    expect(res.partialReads).toEqual([]);
  });

  it("a partial event with no recorded day is no evidence: no flag", async () => {
    const client = fakeClient(binance, spotOnly, undefined, [
      poll("key-b", "2026-09-05T04:00:05+00:00", {
        final_status: "complete_with_warnings",
        row_count: 2,
      }),
    ]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.partialReads).toEqual([]);
  });

  it("a partial key whose account a newer reading superseded contributes no rows and no flag", async () => {
    const client = fakeClient(
      [
        { id: "key-b", user_id: "user-1", exchange: "binance", venue_account_id: "acct-1" },
        { id: "key-n", user_id: "user-1", exchange: "binance", venue_account_id: "acct-1" },
      ],
      [...spotOnly, h("key-n", "2026-09-07", "ETH-PERP")],
      undefined,
      [partial],
    );
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(ids(res.data as Row[])).toEqual(["key-n:2026-09-07:ETH-PERP"]);
    expect(res.partialReads).toEqual([]);
  });

  it("another user's partial event is never read", async () => {
    const client = fakeClient(binance, spotOnly, undefined, [{ ...partial, user_id: "user-2" }]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.partialReads).toEqual([]);
  });

  it("an error returns no flags", async () => {
    const client = fakeClient(binance, spotOnly, {
      table: "allocator_holdings",
      select: COLS,
      message: "rls denied",
    }, [partial]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res).toEqual({ data: null, error: { message: "rls denied" }, partialReads: [] });
  });
});

// ---------------------------------------------------------------------------
// 164.6.6.2.1 CR-01: a poll that left a native-unit account unpriced.
// ---------------------------------------------------------------------------
describe("nativeUnpricedDay (CR-01)", () => {
  it("reads the day from a payload flagged native_unpriced", () => {
    expect(nativeUnpricedDay({ native_unpriced: true, asof: "2026-10-10" })).toBe("2026-10-10");
  });

  it.each([
    ["no flag", { asof: "2026-10-10" }],
    ["flag false", { asof: "2026-10-10", native_unpriced: false }],
    ["flag as a string", { asof: "2026-10-10", native_unpriced: "true" }],
    ["flag without a day", { native_unpriced: true }],
    ["flag with a malformed day", { asof: "Oct 10", native_unpriced: true }],
    ["null payload", null],
    ["a non-object", "native_unpriced"],
  ])("is null for %s", (_label, payload) => {
    expect(nativeUnpricedDay(payload)).toBeNull();
  });

  it("uses the kind prefix the Python poll writes (pinned across runtimes)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const py = readFileSync(
      join(process.cwd(), "analytics-service/services/allocator_positions.py"),
      "utf8",
    );
    expect(py).toContain(`NATIVE_UNPRICED_KIND_PREFIX = "${NATIVE_UNPRICED_KIND_PREFIX}"`);
  });
});

const record = (keyId: string, asof: string, extra: Record<string, unknown> = {}) => ({
  allocator_id: "user-1",
  kind: `${NATIVE_UNPRICED_KIND_PREFIX}${keyId}`,
  payload: { native_unpriced: true, asof, ...extra },
});

describe("fetchLatestHoldingsPerKey: a native key the newest poll left unpriced (CR-01)", () => {
  const btc = [{ id: "key-btc", user_id: "user-1", exchange: "mt5" }];
  const priced = [h("key-btc", "2026-10-09", "ACCOUNT-0123abcd")];

  it("contributes nothing once the poll's record is dated after its rows", async () => {
    const client = fakeClient(btc, priced, undefined, [], [record("key-btc", "2026-10-10")]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res).toEqual({ data: [], error: null, partialReads: [] });
  });

  it("keeps the rows when the record is of the rows' own day", async () => {
    const client = fakeClient(btc, priced, undefined, [], [record("key-btc", "2026-10-09")]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.data).toEqual(priced);
  });

  it("ignores another key's record", async () => {
    const client = fakeClient(btc, priced, undefined, [], [record("key-other", "2026-10-10")]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.data).toEqual(priced);
  });

  it("a forged audit event is no evidence: the same event shapes the poll once wrote change nothing", async () => {
    // log_audit_event lets the owner insert any action/entity/metadata for their own key.
    const client = fakeClient(btc, priced, undefined, [
      poll("key-btc", "2026-10-10T04:00:05+00:00", {
        final_status: "complete_with_warnings",
        row_count: 0,
        asof: "2026-10-10",
        native_unpriced: true,
      }),
    ]);
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.data).toEqual(priced);
  });

  it("a failed record read keeps the key's rows (no worse than before) and is logged, not swallowed", async () => {
    const client = fakeClient(
      btc,
      priced,
      { table: "allocator_equity_derived", select: "payload", message: "derived read down" },
      [],
      [record("key-btc", "2026-10-10")],
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await fetchLatestHoldingsPerKey(client, "user-1", COLS);
    expect(res.error).toBeNull();
    expect(res.data).toEqual(priced);
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("native-unpriced record read failed"),
      "derived read down",
    );
    err.mockRestore();
  });
});

describe("fetchNativeUnpricedDays (CR-01)", () => {
  it("maps each key to its record's day and ignores malformed payloads", async () => {
    const client = fakeClient([], [], undefined, [], [
      record("key-a", "2026-10-10"),
      record("key-b", "2026-10-08"),
      { allocator_id: "user-1", kind: "native_unpriced:key-c", payload: { asof: "2026-10-10" } },
      { allocator_id: "user-1", kind: "key_inputs:key-a", payload: { native_unpriced: true, asof: "2026-10-10" } },
      { allocator_id: "user-2", kind: "native_unpriced:key-z", payload: { native_unpriced: true, asof: "2026-10-10" } },
    ]);
    const res = await fetchNativeUnpricedDays(client, "user-1");
    expect(res.error).toBeNull();
    expect([...res.data.entries()].sort()).toEqual([
      ["key-a", "2026-10-10"],
      ["key-b", "2026-10-08"],
    ]);
  });
});
