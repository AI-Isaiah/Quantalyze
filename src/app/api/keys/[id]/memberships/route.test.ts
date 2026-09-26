import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/keys/[id]/memberships (Phase 167.2.1 D-01, ROADMAP criterion 5).
 *
 * The key card's Delete confirm names every composite a Delete would shrink.
 * It used to read `strategy_keys` in the browser through RLS, and RLS on
 * SELECT FILTERS rather than errors: a regressed policy answered `[]` and the
 * confirm stayed silent while the Delete cascaded a composite's member away.
 * These cases pin the two things that make the route safe to run on the
 * service role: the read does not depend on RLS, and the explicit owner
 * equality is the tenant gate. Ids and names are synthetic.
 */

vi.mock("server-only", () => ({}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const KEY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Result = { data: unknown; error: { message: string; code?: string } | null };

const STATE = vi.hoisted(() => ({
  /** The api_keys rows the admin client can see: id + owner. */
  adminKeys: [] as Array<{ id: string; user_id: string }>,
  ownershipError: null as { message: string; code?: string } | null,
  /** What the admin client's strategy_keys read answers. */
  adminMembers: { data: [], error: null } as Result,
  /** What the request-scoped (RLS) client's strategy_keys read would answer. */
  rlsMembers: { data: [], error: null } as Result,
  rateLimitOk: true,
  adminClientsCreated: 0,
  /** Every (client, table) the route read, in order. */
  reads: [] as Array<{ client: "admin" | "request"; table: string }>,
  /** The eq() filters applied to the admin api_keys read. */
  ownershipFilters: [] as Array<[string, unknown]>,
  captured: [] as Array<{ err: unknown; options: { tags: Record<string, string> } }>,
}));

/**
 * The request-scoped client answers auth for `withAuth` and, if the route were
 * ever to read `strategy_keys` on it, answers `STATE.rlsMembers`: an RLS
 * regression's `[]` by default in the case that exists to prove it is ignored.
 */
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: (table: string) => {
      STATE.reads.push({ client: "request", table });
      return {
        select: () => ({
          eq: () => Promise.resolve(STATE.rlsMembers),
        }),
      };
    },
  }),
}));

/**
 * The admin client. Its api_keys fake filters `STATE.adminKeys` by EVERY eq()
 * the route applies and nothing else, so a foreign key answers a row only when
 * the owner equality is absent (neuter 3).
 */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    STATE.adminClientsCreated += 1;
    return {
      from: (table: string) => {
        STATE.reads.push({ client: "admin", table });
        if (table === "api_keys") {
          const filters: Array<[string, unknown]> = [];
          const chain = {
            select: () => chain,
            eq: (col: string, val: unknown) => {
              filters.push([col, val]);
              STATE.ownershipFilters.push([col, val]);
              return chain;
            },
            maybeSingle: async () => {
              if (STATE.ownershipError) return { data: null, error: STATE.ownershipError };
              const hit = STATE.adminKeys.find((k) =>
                filters.every(([col, val]) => (k as Record<string, unknown>)[col] === val),
              );
              return { data: hit ? { id: hit.id } : null, error: null };
            },
          };
          return chain;
        }
        if (table === "strategy_keys") {
          return {
            select: () => ({
              eq: () => Promise.resolve(STATE.adminMembers),
            }),
          };
        }
        throw new Error(`unexpected admin from(${table})`);
      },
    };
  },
}));

vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    userActionLimiter: null,
    checkLimit: async () => ({
      success: STATE.rateLimitOk,
      retryAfter: STATE.rateLimitOk ? 0 : 60,
    }),
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

function request(keyId: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/keys/${keyId}/memberships`, {
    method: "GET",
  });
}

function strategyRow(name: unknown, status: unknown, ownerId: string = USER_ID) {
  return { strategy_id: `strat-${String(name)}`, strategies: { name, status, user_id: ownerId } };
}

beforeEach(() => {
  STATE.adminKeys = [{ id: KEY_ID, user_id: USER_ID }];
  STATE.ownershipError = null;
  STATE.adminMembers = { data: [], error: null };
  STATE.rlsMembers = { data: [], error: null };
  STATE.rateLimitOk = true;
  STATE.adminClientsCreated = 0;
  STATE.reads = [];
  STATE.ownershipFilters = [];
  STATE.captured = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function expectNoStore(res: Response) {
  expect(res.headers.get("Cache-Control")).toContain("no-store");
}

describe("GET /api/keys/[id]/memberships", () => {
  it("OWN-KEY-MEMBERS: the caller's own key answers 200 with every membership's name and status, no-store", async () => {
    STATE.adminMembers = {
      data: [
        strategyRow("Synthetic Composite A", "draft"),
        strategyRow("Synthetic Composite P", "published"),
      ],
      error: null,
    };
    const res = await GET(request(KEY_ID));
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({
      memberships: [
        { name: "Synthetic Composite A", status: "draft" },
        { name: "Synthetic Composite P", status: "published" },
      ],
    });
  });

  it("RLS-REGRESSION: the request client answering [] (a regressed strategy_keys_owner) cannot hide a membership the service role reads (ROADMAP criterion 5)", async () => {
    // ROADMAP criterion 5 / D-01: RLS on SELECT filters rather than errors, so
    // a regressed policy answers an error-free []. The route must not ask it.
    STATE.rlsMembers = { data: [], error: null };
    STATE.adminMembers = { data: [strategyRow("Synthetic Composite A", "draft")], error: null };
    const res = await GET(request(KEY_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      memberships: [{ name: "Synthetic Composite A", status: "draft" }],
    });
    expect(STATE.reads).not.toContainEqual({ client: "request", table: "strategy_keys" });
    expect(STATE.reads).toContainEqual({ client: "admin", table: "strategy_keys" });
  });

  it("FOREIGN-KEY-404: another user's key answers 404 and no membership is read", async () => {
    STATE.adminKeys = [{ id: KEY_ID, user_id: OTHER_USER_ID }];
    STATE.adminMembers = { data: [strategyRow("Foreign Composite", "draft", OTHER_USER_ID)], error: null };
    const res = await GET(request(KEY_ID));
    expect(res.status).toBe(404);
    expectNoStore(res);
    expect(await res.json()).toEqual({ error: "Key not found" });
    expect(STATE.ownershipFilters).toContainEqual(["user_id", USER_ID]);
    expect(STATE.reads).not.toContainEqual({ client: "admin", table: "strategy_keys" });
  });

  it("ABSENT-KEY-404: an absent key gets the byte-identical 404 a foreign key gets (no existence oracle)", async () => {
    STATE.adminKeys = [{ id: KEY_ID, user_id: OTHER_USER_ID }];
    const foreign = await GET(request(KEY_ID));
    STATE.adminKeys = [];
    const absent = await GET(request(KEY_ID));
    expect(absent.status).toBe(foreign.status);
    expect(await absent.text()).toBe(await foreign.text());
  });

  it("BAD-ID-400: a non-UUID id answers 400 before any client is created", async () => {
    const res = await GET(request("not-a-uuid"));
    expect(res.status).toBe(400);
    expectNoStore(res);
    expect(await res.json()).toEqual({ error: "Invalid key id" });
    expect(STATE.adminClientsCreated).toBe(0);
    expect(STATE.reads.filter((r) => r.client === "admin")).toEqual([]);
  });

  it("OWNERSHIP-ERROR-500: an ownership read error answers 500 and is captured with tags only", async () => {
    STATE.ownershipError = { message: "RAW-PG-DETAIL-sentinel", code: "57014" };
    const res = await GET(request(KEY_ID));
    expect(res.status).toBe(500);
    expectNoStore(res);
    const body = await res.text();
    expect(body).not.toContain("RAW-PG-DETAIL-sentinel");
    expect(STATE.captured).toHaveLength(1);
    // 167.2.1-REVIEW-SFH L-3: the error code rides as a tag, so the event
    // separates a statement timeout (57014) from a permission regression.
    expect(STATE.captured[0].options).toEqual({
      tags: { route: "api/keys/[id]/memberships", stage: "ownership", code: "57014" },
    });
    const serialized = JSON.stringify(STATE.captured.map((c) => [String(c.err), c.options]));
    expect(serialized).not.toContain(KEY_ID);
    expect(serialized).not.toContain(USER_ID);
    expect(STATE.reads).not.toContainEqual({ client: "admin", table: "strategy_keys" });
  });

  it("MEMBERS-ERROR-500: a membership read error answers 500 and is captured with tags only", async () => {
    STATE.adminMembers = { data: null, error: { message: "RAW-PG-DETAIL-sentinel", code: "42501" } };
    const res = await GET(request(KEY_ID));
    expect(res.status).toBe(500);
    expectNoStore(res);
    expect(await res.text()).not.toContain("RAW-PG-DETAIL-sentinel");
    expect(STATE.captured).toHaveLength(1);
    // 167.2.1-REVIEW-SFH L-3: the error code rides as a tag.
    expect(STATE.captured[0].options).toEqual({
      tags: { route: "api/keys/[id]/memberships", stage: "memberships", code: "42501" },
    });
    const serialized = JSON.stringify(STATE.captured.map((c) => [String(c.err), c.options]));
    expect(serialized).not.toContain(KEY_ID);
    expect(serialized).not.toContain(USER_ID);
  });

  it("MEMBERS-NOT-ARRAY-500: a membership answer with no rows array and no error is a 500, never an empty list", async () => {
    STATE.adminMembers = { data: null, error: null };
    const res = await GET(request(KEY_ID));
    expect(res.status).toBe(500);
    expectNoStore(res);
    expect(STATE.captured).toHaveLength(1);
    expect(STATE.captured[0].options.tags.stage).toBe("memberships");
    // No error object at all is its own code, never an empty tag.
    expect(STATE.captured[0].options.tags.code).toBe("no_error");
  });

  it("ERROR-CODE-ABSENT: an error that carries no code is tagged \"none\", never dropped from the event", async () => {
    STATE.ownershipError = { message: "RAW-PG-DETAIL-sentinel" };
    const res = await GET(request(KEY_ID));
    expect(res.status).toBe(500);
    expect(STATE.captured).toHaveLength(1);
    expect(STATE.captured[0].options.tags.code).toBe("none");
  });

  it("RATE-LIMITED: the limiter's deny answer, no-store, and no client read", async () => {
    STATE.rateLimitOk = false;
    const res = await GET(request(KEY_ID));
    expect(res.status).toBe(429);
    expectNoStore(res);
    expect(STATE.adminClientsCreated).toBe(0);
    expect(STATE.reads.filter((r) => r.client === "admin")).toEqual([]);
  });

  it("EMBED-ARRAY: a one-element array embed is unwrapped, and a non-string name is null, never dropped", async () => {
    STATE.adminMembers = {
      data: [
        { strategy_id: "s1", strategies: [{ name: "Synthetic Composite A", status: "pending_review", user_id: USER_ID }] },
        { strategy_id: "s2", strategies: { name: 42, status: "draft", user_id: USER_ID } },
        { strategy_id: "s3", strategies: null },
      ],
      error: null,
    };
    const res = await GET(request(KEY_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      memberships: [
        { name: "Synthetic Composite A", status: "pending_review" },
        { name: null, status: "draft" },
        { name: null, status: null },
      ],
    });
  });

  it("FOREIGN-STRATEGY-REDACTED: a membership whose strategy is not the caller's is listed with no name (defence in depth over the owner-coherence trigger)", async () => {
    STATE.adminMembers = {
      data: [strategyRow("Foreign Composite", "published", OTHER_USER_ID)],
      error: null,
    };
    const res = await GET(request(KEY_ID));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("Foreign Composite");
    expect(JSON.parse(body)).toEqual({ memberships: [{ name: null, status: null }] });
  });
});
