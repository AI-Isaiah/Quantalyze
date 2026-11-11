import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/keys/feeds (Phase 200 D-01, ROUTE-09).
 *
 * One ownership-checked read answers "which strategies does each of my keys
 * feed?" for EVERY key the caller owns, so a list of keys never spends more
 * than one `userActionLimiter` token (5 per 60 s). It runs on the service
 * role, so RLS does not apply and the explicit `user_id` equality is the only
 * tenant gate. The fakes below FILTER seeded rows by every `eq`/`in` the route
 * applies and nothing else, so dropping a filter lets a foreign row through
 * and the privacy cases go red. Ids and names are synthetic.
 */

vi.mock("server-only", () => ({}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const K1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const K2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const K3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const FOREIGN_KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S_FOREIGN = "99999999-9999-4999-8999-999999999999";

type Filter = ["eq" | "in", string, unknown];
type StrategyRow = {
  id: string;
  name: unknown;
  status: unknown;
  user_id: string;
  api_key_id: string | null;
};
type MemberRow = { api_key_id: string; strategy_id: string; strategies: unknown };

const STATE = vi.hoisted(() => ({
  keys: [] as Array<{ id: string; user_id: string }>,
  strategies: [] as Array<{
    id: string;
    name: unknown;
    status: unknown;
    user_id: string;
    api_key_id: string | null;
  }>,
  members: [] as Array<{ api_key_id: string; strategy_id: string; strategies: unknown }>,
  /** A per-table error (or a null answer with no error) the fake returns. */
  errors: {} as Record<string, { message: string; code?: string } | "no-rows">,
  rateLimitOk: true,
  limiterCalls: 0,
  adminClientsCreated: 0,
  /** Every (client, table) the route read, in order. */
  reads: [] as Array<{ client: "admin" | "request"; table: string }>,
  /** The filters the route applied, PER TABLE. */
  filters: {} as Record<string, Array<["eq" | "in", string, unknown]>>,
  captured: [] as Array<{ err: unknown; options: { tags: Record<string, string> } }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: (table: string) => {
      STATE.reads.push({ client: "request", table });
      throw new Error(`the request-scoped client must not read ${table}`);
    },
  }),
}));

function applyFilters(rows: Array<Record<string, unknown>>, filters: Filter[]) {
  return rows.filter((row) =>
    filters.every(([op, col, val]) =>
      op === "eq" ? row[col] === val : (val as unknown[]).includes(row[col]),
    ),
  );
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    STATE.adminClientsCreated += 1;
    return {
      from: (table: string) => {
        STATE.reads.push({ client: "admin", table });
        const filters: Filter[] = [];
        STATE.filters[table] = filters;
        const source =
          table === "api_keys"
            ? (STATE.keys as Array<Record<string, unknown>>)
            : table === "strategies"
              ? (STATE.strategies as Array<Record<string, unknown>>)
              : table === "strategy_keys"
                ? (STATE.members as Array<Record<string, unknown>>)
                : null;
        if (source === null) throw new Error(`unexpected admin from(${table})`);
        const chain = {
          select: () => chain,
          eq: (col: string, val: unknown) => {
            filters.push(["eq", col, val]);
            return chain;
          },
          in: (col: string, val: unknown[]) => {
            filters.push(["in", col, val]);
            return chain;
          },
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            const forced = STATE.errors[table];
            let answer: unknown;
            if (forced === "no-rows") answer = { data: null, error: null };
            else if (forced) answer = { data: null, error: forced };
            else answer = { data: applyFilters(source, filters), error: null };
            return Promise.resolve(answer).then(resolve, reject);
          },
        };
        return chain;
      },
    };
  },
}));

vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    userActionLimiter: null,
    checkLimit: async () => {
      STATE.limiterCalls += 1;
      return { success: STATE.rateLimitOk, retryAfter: STATE.rateLimitOk ? 0 : 60 };
    },
    rateLimitDenyJson: actual.rateLimitDenyJson,
    isRateLimitMisconfigured: actual.isRateLimitMisconfigured,
  };
});

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, options: { tags: Record<string, string> }) => {
    STATE.captured.push({ err, options });
    return Promise.resolve();
  },
}));

import { GET } from "./route";

function request(): NextRequest {
  return new NextRequest("http://localhost:3000/api/keys/feeds", { method: "GET" });
}

function strategy(id: string, name: unknown, over: Partial<StrategyRow> = {}): StrategyRow {
  return { id, name, status: "draft", user_id: USER_ID, api_key_id: null, ...over };
}

function member(
  keyId: string,
  strategyId: string,
  name: unknown,
  ownerId: string = USER_ID,
  status: unknown = "draft",
): MemberRow {
  return {
    api_key_id: keyId,
    strategy_id: strategyId,
    strategies: { name, status, user_id: ownerId },
  };
}

beforeEach(() => {
  STATE.keys = [
    { id: K1, user_id: USER_ID },
    { id: K2, user_id: USER_ID },
    { id: K3, user_id: USER_ID },
    { id: FOREIGN_KEY, user_id: OTHER_USER_ID },
  ];
  STATE.strategies = [];
  STATE.members = [];
  STATE.errors = {};
  STATE.rateLimitOk = true;
  STATE.limiterCalls = 0;
  STATE.adminClientsCreated = 0;
  STATE.reads = [];
  STATE.filters = {};
  STATE.captured = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function expectNoStore(res: Response) {
  expect(res.headers.get("Cache-Control")).toContain("no-store");
}

describe("GET /api/keys/feeds", () => {
  it("BOTH-KINDS: a single link, a composite member and an unlinked key come back keyed by key id, no-store", async () => {
    STATE.strategies = [strategy(S1, "Synthetic Single", { api_key_id: K1, status: "published" })];
    STATE.members = [member(K2, S2, "Synthetic Composite", USER_ID, "draft")];
    const res = await GET(request());
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({
      feeds: {
        [K1]: [{ strategy_id: S1, name: "Synthetic Single", status: "published", kind: "single" }],
        [K2]: [{ strategy_id: S2, name: "Synthetic Composite", status: "draft", kind: "composite" }],
        [K3]: [],
      },
    });
  });

  it("ADMIN-OWNER-FILTERS: every read runs on the service role and the key and single-link reads are scoped to the caller", async () => {
    await GET(request());
    expect(STATE.reads.filter((r) => r.client === "request")).toEqual([]);
    expect(STATE.reads).toEqual([
      { client: "admin", table: "api_keys" },
      { client: "admin", table: "strategy_keys" },
      { client: "admin", table: "strategies" },
    ]);
    expect(STATE.filters.api_keys).toContainEqual(["eq", "user_id", USER_ID]);
    expect(STATE.filters.strategies).toContainEqual(["eq", "user_id", USER_ID]);
    // The route takes no id from the caller: it asks only for the caller's own.
    expect(STATE.filters.strategy_keys).toContainEqual(["in", "api_key_id", [K1, K2, K3]]);
    expect(STATE.filters.strategies).toContainEqual(["in", "api_key_id", [K1, K2, K3]]);
  });

  it("FOREIGN-KEY-ABSENT: another user's key is not in the map, and nothing is read for it", async () => {
    STATE.strategies = [
      strategy(S_FOREIGN, "Foreign Single", { api_key_id: FOREIGN_KEY, user_id: OTHER_USER_ID }),
    ];
    const res = await GET(request());
    const body = await res.text();
    expect(Object.keys(JSON.parse(body).feeds).sort()).toEqual([K1, K2, K3]);
    expect(body).not.toContain(FOREIGN_KEY);
    expect(body).not.toContain("Foreign Single");
    expect(body).not.toContain(S_FOREIGN);
  });

  it("FOREIGN-SINGLE-LINK-HIDDEN: a strategy owned by someone else that points at the caller's key is never named or id'd (T-200-01)", async () => {
    STATE.strategies = [
      strategy(S_FOREIGN, "Foreign Single", { api_key_id: K1, user_id: OTHER_USER_ID }),
      strategy(S1, "Synthetic Single", { api_key_id: K1 }),
    ];
    const res = await GET(request());
    const body = await res.text();
    expect(body).not.toContain("Foreign Single");
    expect(body).not.toContain(S_FOREIGN);
    expect(JSON.parse(body).feeds[K1]).toEqual([
      { strategy_id: S1, name: "Synthetic Single", status: "draft", kind: "single" },
    ]);
  });

  it("COMPOSITE-FOREIGN-REDACTED: a composite row whose strategy is not the caller's is listed with no id, name or status, and counted (stage coherence)", async () => {
    STATE.members = [
      member(K2, S_FOREIGN, "Foreign Composite", OTHER_USER_ID, "published"),
      { api_key_id: K2, strategy_id: "s-dangling", strategies: null },
      member(K2, S2, "Synthetic Composite"),
    ];
    const consoleError = vi.mocked(console.error);
    consoleError.mockClear();
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const leak of ["Foreign Composite", S_FOREIGN, "s-dangling", OTHER_USER_ID]) {
      expect(body).not.toContain(leak);
    }
    expect(JSON.parse(body).feeds[K2]).toEqual([
      { strategy_id: S2, name: "Synthetic Composite", status: "draft", kind: "composite" },
      { strategy_id: null, name: null, status: null, kind: "composite" },
      { strategy_id: null, name: null, status: null, kind: "composite" },
    ]);
    expect(STATE.captured).toHaveLength(1);
    expect(String(STATE.captured[0].err)).toContain("strategy owner mismatch or dangling embed");
    expect(STATE.captured[0].options).toEqual({
      tags: { route: "api/keys/feeds", stage: "coherence" },
      extra: { ownerMismatches: 1, danglingEmbeds: 1 },
    });
    const serialized = JSON.stringify(STATE.captured.map((c) => [String(c.err), c.options]));
    for (const leak of [K2, USER_ID, OTHER_USER_ID, "Foreign Composite", "s-dangling"]) {
      expect(serialized).not.toContain(leak);
    }
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("owner-coherence tripwire fired"),
      { ownerMismatches: 1, danglingEmbeds: 1 },
    );
  });

  it("COHERENCE-QUIET: a clean answer captures and logs nothing", async () => {
    STATE.members = [member(K2, S2, "Synthetic Composite")];
    const consoleError = vi.mocked(console.error);
    consoleError.mockClear();
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(STATE.captured).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("EMBED-ARRAY: a one-element array embed is unwrapped, and a non-string name is null, never dropped", async () => {
    STATE.members = [
      { api_key_id: K2, strategy_id: S2, strategies: [{ name: "Synthetic Composite", status: "pending_review", user_id: USER_ID }] },
      { api_key_id: K2, strategy_id: "22222222-2222-4222-8222-222222222223", strategies: { name: 42, status: "draft", user_id: USER_ID } },
    ];
    const res = await GET(request());
    expect((await res.json()).feeds[K2]).toEqual([
      { strategy_id: S2, name: "Synthetic Composite", status: "pending_review", kind: "composite" },
      { strategy_id: "22222222-2222-4222-8222-222222222223", name: null, status: "draft", kind: "composite" },
    ]);
  });

  it.each([
    ["api_keys", "ownership", { message: "RAW-PG-DETAIL-sentinel", code: "57014" }, "57014"],
    ["strategy_keys", "memberships", { message: "RAW-PG-DETAIL-sentinel", code: "42501" }, "42501"],
    ["strategies", "single-links", { message: "RAW-PG-DETAIL-sentinel" }, "none"],
  ] as const)(
    "READ-ERROR-500 (%s): an error answers 500 Lookup failed, never an empty map, captured with tags only",
    async (table, stage, pgError, code) => {
      STATE.errors = { [table]: pgError };
      const res = await GET(request());
      expect(res.status).toBe(500);
      expectNoStore(res);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "Lookup failed" });
      expect(text).not.toContain("RAW-PG-DETAIL-sentinel");
      expect(STATE.captured).toHaveLength(1);
      expect(STATE.captured[0].options).toEqual({
        tags: { route: "api/keys/feeds", stage, code },
      });
      const serialized = JSON.stringify(STATE.captured.map((c) => [String(c.err), c.options]));
      expect(serialized).not.toContain(USER_ID);
      expect(serialized).not.toContain(K1);
    },
  );

  it.each([
    ["api_keys", "ownership"],
    ["strategy_keys", "memberships"],
    ["strategies", "single-links"],
  ] as const)(
    "NOT-ARRAY-500 (%s): an answer with no rows array and no error is a 500, never an empty map",
    async (table, stage) => {
      STATE.errors = { [table]: "no-rows" };
      const res = await GET(request());
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Lookup failed" });
      expect(STATE.captured).toHaveLength(1);
      expect(STATE.captured[0].options.tags).toEqual({
        route: "api/keys/feeds",
        stage,
        code: "no_error",
      });
    },
  );

  it("SEVEN-KEYS-ONE-CALL: one request answers seven keys with one limiter token and one admin client (a list never trips the 5-per-60s limiter)", async () => {
    const ids = Array.from(
      { length: 7 },
      (_, i) => `cccccccc-cccc-4ccc-8ccc-ccccccccccc${i}`,
    );
    STATE.keys = ids.map((id) => ({ id, user_id: USER_ID }));
    STATE.strategies = [strategy(S1, "Synthetic Single", { api_key_id: ids[6] })];
    const res = await GET(request());
    expect(res.status).toBe(200);
    const { feeds } = await res.json();
    expect(Object.keys(feeds).sort()).toEqual([...ids].sort());
    expect(feeds[ids[6]]).toHaveLength(1);
    expect(feeds[ids[0]]).toEqual([]);
    expect(STATE.limiterCalls).toBe(1);
    expect(STATE.adminClientsCreated).toBe(1);
  });

  it("STABLE-ORDER: within a key, names sort case-insensitively, nulls last, equal names by strategy id", async () => {
    const A1 = "00000000-0000-4000-8000-0000000000a1";
    const A2 = "00000000-0000-4000-8000-0000000000a2";
    const B1 = "00000000-0000-4000-8000-0000000000b1";
    const N1 = "00000000-0000-4000-8000-0000000000c1";
    // Seeded in the order that a naive sort would leave them: id order inverted.
    STATE.strategies = [
      strategy(N1, null, { api_key_id: K1 }),
      strategy(A2, "Alpha", { api_key_id: K1 }),
      strategy(B1, "bravo", { api_key_id: K1 }),
      strategy(A1, "Alpha", { api_key_id: K1 }),
    ];
    const res = await GET(request());
    const ids = (await res.json()).feeds[K1].map((f: { strategy_id: string }) => f.strategy_id);
    expect(ids).toEqual([A1, A2, B1, N1]);
  });

  it("ZERO-KEYS: a caller with no keys gets 200 { feeds: {} } and no feed read", async () => {
    STATE.keys = [{ id: FOREIGN_KEY, user_id: OTHER_USER_ID }];
    const res = await GET(request());
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ feeds: {} });
    expect(STATE.reads).toEqual([{ client: "admin", table: "api_keys" }]);
  });

  it("RATE-LIMITED: the limiter's deny answer, no-store, and no client read", async () => {
    STATE.rateLimitOk = false;
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await GET(request());
      expect(res.status).toBe(429);
      expectNoStore(res);
      expect(STATE.adminClientsCreated).toBe(0);
      expect(STATE.reads).toEqual([]);
      // The browser has no Sentry, so this server line is the one trace that a
      // feeds line read "could not check" for this reason. No user id.
      const denyLines = consoleWarn.mock.calls.filter(([msg]) =>
        String(msg).includes("feeds read denied by the limiter"),
      );
      expect(denyLines).toEqual([[expect.any(String), { status: 429 }]]);
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(USER_ID);
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
