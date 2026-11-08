/**
 * Phase 197 plan 02 (CLAR-05 data side, D-01, D-02) - the admin-gated,
 * published-only, names-only partner map.
 *
 * The Supabase admin client is replaced by a fake that BEHAVES like PostgREST for
 * the three predicates the module relies on (`select` projection, `eq`, `in`), so
 * the published-only fence and the column list are proven by what comes back, not
 * only by what was recorded. A test that merely asserted "eq was called" would stay
 * green with the fence in the wrong place.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// server-only throws under jsdom/vitest; the module under test and the admin
// client both import it.
vi.mock("server-only", () => ({}));

const isAdminUser = vi.fn();
vi.mock("@/lib/admin", () => ({
  isAdminUser: (...args: unknown[]) => isAdminUser(...args),
}));

const captureToSentry = vi.fn();
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (...args: unknown[]) => captureToSentry(...args),
}));

type Row = Record<string, unknown>;
type TableFixture = {
  rows: Row[];
  error?: { message: string };
  throws?: Error;
  /** Error only the range page that starts at this offset. */
  errorAtRangeFrom?: Record<number, { message: string }>;
};
type Call = {
  table: string;
  select: string;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
  orders: string[];
  range?: [number, number];
};

let fixtures: Record<string, TableFixture> = {};
let calls: Call[] = [];
const createAdminClient = vi.fn();

function fakeAdminClient() {
  return {
    from(table: string) {
      const call: Call = { table, select: "", eqs: [], ins: [], orders: [] };
      calls.push(call);
      const builder = {
        select(cols: string) {
          call.select = cols;
          return builder;
        },
        eq(col: string, val: unknown) {
          call.eqs.push([col, val]);
          return builder;
        },
        in(col: string, vals: unknown[]) {
          call.ins.push([col, vals]);
          return builder;
        },
        order(col: string) {
          call.orders.push(col);
          return builder;
        },
        range(from: number, to: number) {
          call.range = [from, to];
          return builder;
        },
        returns() {
          return builder;
        },
        then(resolve: (v: { data: Row[] | null; error: { message: string } | null }) => void, reject: (e: unknown) => void) {
          const fx = fixtures[table] ?? { rows: [] };
          if (fx.throws) return reject(fx.throws);
          if (fx.error) return resolve({ data: null, error: fx.error });
          const rangeError = call.range ? fx.errorAtRangeFrom?.[call.range[0]] : undefined;
          if (rangeError) return resolve({ data: null, error: rangeError });
          const cols = call.select.split(",").map((c) => c.trim());
          const data = fx.rows
            .filter((r) => call.eqs.every(([c, v]) => r[c] === v))
            .filter((r) => call.ins.every(([c, vs]) => vs.includes(r[c])))
            // PostgREST orders, then applies the range, then caps at max_rows (1000).
            .sort((a, b) => {
              const col = call.orders[0];
              return col ? String(a[col]).localeCompare(String(b[col])) : 0;
            })
            .slice(call.range ? call.range[0] : 0, call.range ? call.range[1] + 1 : 1000)
            .slice(0, 1000)
            // PostgREST projects only the selected columns; so does the fake.
            .map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
          return resolve({ data, error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClient(),
}));

import {
  getSharedAccountPartners,
  groupSharedAccountPartners,
} from "./shared-account-partners";

const user = { id: "viewer-1", email: "admin@example.test" };
const supabase = {} as SupabaseClient;

const strat = (id: string, name: string, api_key_id: string | null, status = "published"): Row => ({
  id,
  name,
  api_key_id,
  status,
});
const key = (
  id: string,
  exchange: string | null,
  venue_account_id: string | null,
  account_shared_with_api_key_id: string | null = null,
): Row => ({
  id,
  exchange,
  venue_account_id,
  account_shared_with_api_key_id,
  // A column the module must never select; the fake only returns selected columns.
  api_secret_encrypted: "ENCRYPTED-SECRET-DO-NOT-LEAK",
});

beforeEach(() => {
  fixtures = {};
  calls = [];
  isAdminUser.mockReset();
  captureToSentry.mockReset();
  createAdminClient.mockReset();
  createAdminClient.mockImplementation(() => fakeAdminClient());
});

describe("getSharedAccountPartners - admin gate (D-01)", () => {
  it("returns null for a non-admin and never creates the service-role client", async () => {
    // WHY: the module that holds the service role must refuse a non-admin
    // whatever its caller does; the only proof is that createAdminClient is
    // never reached.
    isAdminUser.mockResolvedValue(false);
    const out = await getSharedAccountPartners(supabase, user, ["s1"]);
    expect(out).toBeNull();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns null for a null viewer without creating the client (isAdminUser fails closed)", async () => {
    // WHY: isAdminUser returns false on its own read error; that must read as
    // "not admin", never as "admin until proven otherwise".
    isAdminUser.mockResolvedValue(false);
    expect(await getSharedAccountPartners(supabase, null, ["s1"])).toBeNull();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("getSharedAccountPartners - one identity kind end to end (venue)", () => {
  beforeEach(() => {
    isAdminUser.mockResolvedValue(true);
    fixtures = {
      strategies: { rows: [strat("s1", "Alpha", "k1"), strat("s2", "Beta", "k2")] },
      strategy_keys: { rows: [] },
      api_keys: { rows: [key("k1", "binance", "acct-1"), key("k2", "binance", "acct-1")] },
    };
  });

  it("maps each strategy to the other's name when their keys share exchange and venue account", async () => {
    const out = await getSharedAccountPartners(supabase, user, ["s1", "s2"]);
    expect(out).toEqual({ s1: ["Beta"], s2: ["Alpha"] });
  });

  it("puts the published predicate on the strategies read", async () => {
    await getSharedAccountPartners(supabase, user, ["s1", "s2"]);
    const strategiesCall = calls.find((c) => c.table === "strategies");
    expect(strategiesCall?.eqs).toContainEqual(["status", "published"]);
  });
});

describe("groupSharedAccountPartners - the identity rule", () => {
  // The pure grouping core takes plain rows, so these cases do not need the fake.
  type G = Parameters<typeof groupSharedAccountPartners>[0];
  const group = (g: Partial<G> & Pick<G, "strategies" | "apiKeys">) =>
    groupSharedAccountPartners({
      strategyKeys: [],
      forStrategyIds: g.strategies.map((s) => s.id),
      ...g,
    });
  const S = (id: string, name: string, api_key_id: string | null) => ({ id, name, api_key_id });
  const K = (
    id: string,
    exchange: string | null,
    venue_account_id: string | null,
    account_shared_with_api_key_id: string | null = null,
  ) => ({ id, exchange, venue_account_id, account_shared_with_api_key_id });

  it("treats the exchange case-blind and trimmed, and the venue id trimmed (the Python rule)", () => {
    // WHY: account_identity_collisions compares exchange.strip().lower() and
    // venue_id.strip(); a stricter comparison here would silently miss a pair the
    // derive already refuses as a double count.
    const out = group({
      strategies: [S("s1", "Alpha", "k1"), S("s2", "Beta", "k2")],
      apiKeys: [K("k1", "Binance ", " 123 "), K("k2", "binance", "123")],
    });
    expect(out).toEqual({ s1: ["Beta"], s2: ["Alpha"] });
  });

  it("does not group the same venue id on different exchanges", () => {
    // WHY: a venue id is only unique within its exchange.
    const out = group({
      strategies: [S("s1", "Alpha", "k1"), S("s2", "Beta", "k2")],
      apiKeys: [K("k1", "binance", "123"), K("k2", "okx", "123")],
    });
    expect(out).toEqual({});
  });

  it("never groups two strategies on a blank, whitespace-only or null venue id", () => {
    // WHY: a blank venue id is unknown identity, not a shared account; grouping on
    // it would name unrelated strategies to every admin.
    const out = group({
      strategies: [S("s1", "Alpha", "k1"), S("s2", "Beta", "k2"), S("s3", "Gamma", "k3")],
      apiKeys: [K("k1", "binance", ""), K("k2", "binance", "   "), K("k3", "binance", null)],
    });
    expect(out).toEqual({});
  });

  it("groups two strategies on the same key id even with no venue id", () => {
    // WHY: one key behind two listings is the same account by construction.
    const out = group({
      strategies: [S("s1", "Alpha", "k1"), S("s2", "Beta", "k1")],
      apiKeys: [K("k1", "binance", null)],
    });
    expect(out).toEqual({ s1: ["Beta"], s2: ["Alpha"] });
  });

  it("groups through the holder pointer (account_shared_with_api_key_id)", () => {
    // WHY: the daily identity stamper marks a key against the live holder of the
    // same account; the marked key and the holder are one account even when their
    // venue ids differ or are unknown.
    const out = group({
      strategies: [S("s1", "Alpha", "k1"), S("s2", "Beta", "k2")],
      apiKeys: [K("k1", "binance", null), K("k2", "binance", null, "k1")],
    });
    expect(out).toEqual({ s1: ["Beta"], s2: ["Alpha"] });
  });

  it("counts a composite member key (strategy_keys) as the strategy's account", () => {
    // WHY: get_published_trade_venues reaches a composite through strategy_keys as
    // well as strategies.api_key_id; a composite whose member shares an account
    // with a published strategy is a shared account.
    const out = group({
      strategies: [S("c1", "Composite", null), S("s2", "Beta", "k2")],
      strategyKeys: [{ strategy_id: "c1", api_key_id: "k1" }],
      apiKeys: [K("k1", "binance", "acct-9"), K("k2", "binance", "acct-9")],
    });
    expect(out).toEqual({ c1: ["Beta"], s2: ["Composite"] });
  });

  it("still groups on a key id that has no api_keys row", () => {
    // WHY: the key id itself is identity; losing the row (a read that came back
    // short) must not make two strategies on one key look unrelated.
    const out = group({
      strategies: [S("s1", "Alpha", "k1"), S("s2", "Beta", "k1")],
      apiKeys: [],
    });
    expect(out).toEqual({ s1: ["Beta"], s2: ["Alpha"] });
  });

  it("limits the output keys to forStrategyIds and still names a partner outside that list", () => {
    // WHY: the page asks about the listed category; a partner in another discovery
    // category is still a partner to name, but gets no entry of its own.
    const out = group({
      strategies: [S("s1", "Alpha", "k1"), S("s2", "Beta", "k2")],
      apiKeys: [K("k1", "binance", "1"), K("k2", "binance", "1")],
      forStrategyIds: ["s1"],
    });
    expect(out).toEqual({ s1: ["Beta"] });
  });

  it("sorts partner names by name, ties by id, and gives a strategy with no partner no entry", () => {
    // WHY: a stable order keeps the rendered line from reshuffling between loads.
    const out = group({
      strategies: [
        S("s0", "Zulu", "k0"),
        S("s3", "Same", "k3"),
        S("s1", "Same", "k1"),
        S("s2", "Alpha", "k2"),
        S("loner", "Loner", "k9"),
      ],
      apiKeys: [
        K("k0", "binance", "1"),
        K("k1", "binance", "1"),
        K("k2", "binance", "1"),
        K("k3", "binance", "1"),
        K("k9", "binance", "other"),
      ],
      forStrategyIds: ["s0", "loner"],
    });
    expect(out).toEqual({ s0: ["Alpha", "Same", "Same"] });
    expect(out).not.toHaveProperty("loner");
  });
});

describe("getSharedAccountPartners - published-only fence (D-02)", () => {
  beforeEach(() => {
    isAdminUser.mockResolvedValue(true);
  });

  it("never names an unpublished partner and gives the published strategy no entry", async () => {
    // WHY: the service role bypasses RLS, so the published predicate is the only
    // thing keeping a draft's existence from an admin-page payload (D-02). The fake
    // applies the eq filter, so this goes RED if the fence is removed.
    fixtures = {
      strategies: {
        rows: [
          strat("s1", "Alpha", "k1"),
          strat("draft", "Secret Draft", "k2", "draft"),
          strat("pending", "Pending One", "k2", "pending_review"),
        ],
      },
      strategy_keys: { rows: [] },
      api_keys: { rows: [key("k1", "binance", "acct-1"), key("k2", "binance", "acct-1")] },
    };
    const out = await getSharedAccountPartners(supabase, user, ["s1", "draft", "pending"]);
    expect(out).toEqual({});
    expect(JSON.stringify(out)).not.toContain("Secret Draft");
    expect(JSON.stringify(out)).not.toContain("Pending One");
  });

  it("does not read an unpublished strategy's keys at all", async () => {
    // WHY: structural, not cosmetic - an unpublished strategy's key must not even
    // be fetched, so it cannot reach a group.
    fixtures = {
      strategies: {
        rows: [strat("s1", "Alpha", "k1"), strat("draft", "Draft", "k-draft", "draft")],
      },
      strategy_keys: { rows: [] },
      api_keys: { rows: [key("k1", "binance", "1"), key("k-draft", "binance", "1")] },
    };
    await getSharedAccountPartners(supabase, user, ["s1"]);
    const apiKeysCall = calls.find((c) => c.table === "api_keys");
    const requested = apiKeysCall?.ins.flatMap(([, vs]) => vs) ?? [];
    expect(requested).toEqual(["k1"]);
  });
});

describe("getSharedAccountPartners - what leaves the function (T-197-04)", () => {
  it("returns names only: no exchange, venue id, key id, label or encrypted value anywhere", async () => {
    // WHY: an admin page's RSC payload must carry names and nothing that identifies
    // the exchange account. The serialised output is searched for every identifier
    // in the fixtures, including a column the module must never select.
    isAdminUser.mockResolvedValue(true);
    fixtures = {
      strategies: { rows: [strat("s1", "Alpha", "key-uuid-AAA"), strat("s2", "Beta", "key-uuid-BBB")] },
      strategy_keys: { rows: [] },
      api_keys: {
        rows: [
          { ...key("key-uuid-AAA", "binance", "VENUE-ID-777"), label: "My Binance Main" },
          { ...key("key-uuid-BBB", "binance", "VENUE-ID-777"), label: "Second Login" },
        ],
      },
    };
    const out = await getSharedAccountPartners(supabase, user, ["s1", "s2"]);
    const text = JSON.stringify(out);
    for (const needle of [
      "binance",
      "VENUE-ID-777",
      "key-uuid-AAA",
      "key-uuid-BBB",
      "My Binance Main",
      "Second Login",
      "ENCRYPTED-SECRET-DO-NOT-LEAK",
    ]) {
      expect(text).not.toContain(needle);
    }
    expect(out).toEqual({ s1: ["Beta"], s2: ["Alpha"] });
  });

  it("selects no encrypted, secret, passphrase or label column from api_keys", async () => {
    // WHY: pins the column list, so widening it to a credential column is a test
    // failure and not a quiet payload change.
    isAdminUser.mockResolvedValue(true);
    fixtures = {
      strategies: { rows: [strat("s1", "Alpha", "k1")] },
      strategy_keys: { rows: [] },
      api_keys: { rows: [key("k1", "binance", "1")] },
    };
    await getSharedAccountPartners(supabase, user, ["s1"]);
    const select = calls.find((c) => c.table === "api_keys")?.select ?? "";
    expect(select).toBe("id, exchange, venue_account_id, account_shared_with_api_key_id");
    expect(select).not.toMatch(/encrypted|secret|passphrase|label/i);
  });
});

describe("getSharedAccountPartners - a catalogue past PostgREST max_rows (WR-02)", () => {
  // The fake caps every response at 1000 rows, as PostgREST does, with no error.
  const PAGE = 1000;
  const pad = (n: number) => String(n).padStart(5, "0");
  // 1000 filler strategies on their own keys, then two sharing an account that sort
  // after them by id, so both are rows 1001 and 1002 and an unpaged read never sees them.
  const filler = Array.from({ length: PAGE }, (_, i) => strat(`s${pad(i)}`, `Filler ${i}`, `kf${i}`));

  beforeEach(() => {
    isAdminUser.mockResolvedValue(true);
    fixtures = {
      strategies: { rows: [...filler, strat("zz-a", "Zeta", "k1"), strat("zz-b", "Eta", "k2")] },
      strategy_keys: { rows: [] },
      api_keys: {
        rows: [key("k1", "binance", "acct-1"), key("k2", "binance", "acct-1"), ...filler.map((s) => key(String(s.api_key_id), "okx", `v-${s.id}`))],
      },
    };
  });

  it("reads a full first page and a short second page, and names a partner that only page 2 holds", async () => {
    // WHY: PostgREST cuts a response at max_rows with no error. Unpaged, the
    // second-page strategy never arrives, so the admin sees no shared-account
    // line for a pair that does share an account, and nothing says it was cut.
    const out = await getSharedAccountPartners(supabase, user, ["zz-a", "zz-b"]);
    expect(out).toEqual({ "zz-a": ["Eta"], "zz-b": ["Zeta"] });
    const ranges = calls.filter((c) => c.table === "strategies").map((c) => c.range);
    expect(ranges).toEqual([
      [0, PAGE - 1],
      [PAGE, 2 * PAGE - 1],
    ]);
    // A stable order is what makes consecutive ranges disjoint and complete.
    expect(calls.filter((c) => c.table === "strategies").every((c) => c.orders[0] === "id")).toBe(true);
  });

  it("returns null and captures to Sentry when the second page errors, never a half-read map", async () => {
    // WHY: fail closed. A map built from page 1 alone looks complete and is wrong.
    fixtures.strategies.errorAtRangeFrom = { [PAGE]: { message: "page 2 boom" } };
    const out = await getSharedAccountPartners(supabase, user, ["zz-a", "zz-b"]);
    expect(out).toBeNull();
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    const [, opts] = captureToSentry.mock.calls[0] as [Error, { tags: Record<string, string> }];
    expect(opts.tags.reason).toBe("strategies_read_error");
  });

  it("stops after one page when it comes back short", async () => {
    fixtures.strategies.rows = [strat("s1", "Alpha", "k1"), strat("s2", "Beta", "k2")];
    await getSharedAccountPartners(supabase, user, ["s1", "s2"]);
    expect(calls.filter((c) => c.table === "strategies")).toHaveLength(1);
  });
});

describe("getSharedAccountPartners - fail closed (T-197-07)", () => {
  beforeEach(() => {
    isAdminUser.mockResolvedValue(true);
    fixtures = {
      strategies: { rows: [strat("s1", "Alpha", "k1"), strat("s2", "Beta", "k2")] },
      strategy_keys: { rows: [] },
      api_keys: { rows: [key("k1", "binance", "1"), key("k2", "binance", "1")] },
    };
  });

  function expectCaptured(reason: string) {
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    const [err, opts] = captureToSentry.mock.calls[0] as [Error, { tags: Record<string, string> }];
    expect(err).toBeInstanceOf(Error);
    expect(opts.tags.stage).toBe("shared-account-partners");
    expect(opts.tags.reason).toBe(reason);
  }

  it.each([
    ["strategies", "strategies_read_error"],
    ["strategy_keys", "strategy_keys_read_error"],
    ["api_keys", "api_keys_read_error"],
  ])("returns null and captures to Sentry when the %s read errors", async (table, reason) => {
    // WHY: an admin-only informational line must never take discovery down, and a
    // half-read must never render a partial (wrong) set of notices.
    fixtures[table] = { rows: [], error: { message: "boom" } };
    const out = await getSharedAccountPartners(supabase, user, ["s1", "s2"]);
    expect(out).toBeNull();
    expectCaptured(reason);
  });

  it("returns null and captures to Sentry when the client throws", async () => {
    fixtures.api_keys = { rows: [], throws: new Error("network down") };
    const out = await getSharedAccountPartners(supabase, user, ["s1", "s2"]);
    expect(out).toBeNull();
    expectCaptured("read_threw");
  });

  it("returns null and captures to Sentry when creating the admin client throws", async () => {
    // WHY: createAdminClient throws on a missing service key; the reader must not
    // let that escape into the page.
    createAdminClient.mockImplementation(() => {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    });
    const out = await getSharedAccountPartners(supabase, user, ["s1"]);
    expect(out).toBeNull();
    expectCaptured("read_threw");
  });
});
