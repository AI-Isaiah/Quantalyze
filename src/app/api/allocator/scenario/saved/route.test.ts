/**
 * Phase 23 / Plan 02 / PERSIST-01 + PERSIST-03 — TDD tests for
 * GET + POST /api/allocator/scenario/saved.
 *
 * Covered behaviours:
 *   T_S1  No auth (withAllocatorAuth gate)                                  → 401
 *   T_S2  Invalid body (missing draft)                                      → 400, limiter NOT called
 *   T_S3  Empty name                                                        → 400, limiter NOT called
 *   T_S4  Name > 120 chars                                                  → 400, limiter NOT called
 *   T_S5  Rate-limit denied                                                 → 429 + Retry-After + Cache-Control
 *   T_S6  Rate-limit misconfigured                                          → 503 + Retry-After + Cache-Control
 *   T_S7  Success                                                           → 200; insert fired
 *   T_S8  Cross-tenant — body allocator_id IGNORED, insert uses user.id     → 200; payload.allocator_id === user.id
 *   T_S9  DB error → redacted stable message (NOT raw error.message)        → 500
 *   T_S10 NO_STORE_HEADERS on success AND error responses
 *   T_S11 GET lists the caller's rows (RLS), ordered updated_at desc        → 200; select/order called
 *   T_S12 GET DB error → redacted + 500 + Cache-Control
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// `import "server-only"` (transitive via withAllocatorAuth) throws in jsdom.
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Mock withAllocatorAuth — toggleable for the 401 path. The real wrapper drops
// the route ctx and only forwards (req, user); mirror that here.
// ---------------------------------------------------------------------------

const MOCK_USER = { id: "alloc-A" } as unknown as import("@supabase/supabase-js").User;
let authShouldFail = false;

vi.mock("@/lib/api/withAllocatorAuth", () => ({
  withAllocatorAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) => (req: NextRequest) => {
      if (authShouldFail) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json", "Cache-Control": "private, no-store" },
        });
      }
      return h(req, MOCK_USER);
    },
}));

// ---------------------------------------------------------------------------
// Mock supabase server client — a chainable query builder.
//   .from("scenarios").insert(payload).select(cols).single()  → { data, error }
//   .from("scenarios").select(cols).order(...)                 → { data, error }
// The insert/select payloads are captured so the cross-tenant + RLS-ordering
// assertions can inspect them.
// ---------------------------------------------------------------------------

type DbResult = { data: unknown; error: { code?: string; message: string } | null };
let insertResult: DbResult = { data: { id: "scen-1" }, error: null };
let listResult: DbResult = { data: [], error: null };
let lastInsertPayload: Record<string, unknown> | null = null;
const orderSpy = vi.fn();

function buildChain() {
  // Insert path: insert() -> select() -> single() resolves insertResult.
  // List path: select() -> order() resolves listResult.
  const chain = {
    insert(payload: Record<string, unknown>) {
      lastInsertPayload = payload;
      return {
        select: () => ({
          single: async () => insertResult,
        }),
      };
    },
    select(cols: string) {
      return {
        order: (col: string, opts: unknown) => {
          orderSpy(cols, col, opts);
          return Promise.resolve(listResult);
        },
      };
    },
  };
  return chain;
}

const fromSpy = vi.fn(() => buildChain());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: fromSpy }),
}));

// ---------------------------------------------------------------------------
// Mock rate limiter — toggleable so a deny / misconfig can be forced, and the
// call count is assertable (a 400 must NOT consume a token → checkLimit not
// called).
// ---------------------------------------------------------------------------

let rateLimitState: "allow" | "deny" | "misconfig" = "allow";
const checkLimitMock = vi.fn(async () => {
  if (rateLimitState === "allow") return { success: true };
  if (rateLimitState === "misconfig")
    return { success: false, retryAfter: 60, reason: "ratelimit_misconfigured" };
  return { success: false, retryAfter: 42 };
});
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: (...args: unknown[]) => checkLimitMock(...(args as [])),
  isRateLimitMisconfigured: (rl: { success: boolean; reason?: string }) =>
    rl.success === false && rl.reason === "ratelimit_misconfigured",
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// logAuditEvent imports server-only + next/server `after`; mock it so the route
// import resolves under jsdom and so a test can assert the save emit fires.
const logAuditEventMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  logAuditEvent: (...args: unknown[]) => logAuditEventMock(...args),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET, POST, MAX_DRAFT_BODY_BYTES } from "./route";
import { scenarioDraftSchema } from "@/app/(dashboard)/allocations/lib/scenario-state";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_DRAFT = {
  schema_version: 2,
  init_holdings_fingerprint: "BTC:binance:spot|ETH:binance:spot",
  toggleByScopeRef: { "holding:binance:BTC:spot": true },
  addedStrategies: [],
  weightOverrides: { "holding:binance:BTC:spot": 1 },
  lastEditedAt: "2026-06-21T00:00:00.000Z",
};

function mkPost(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/allocator/scenario/saved"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

// FIX A — POST with a raw (already-serialised) body string, so a test can
// craft an oversized payload that the byte-cap must reject before parse.
function mkPostRaw(rawBody: string) {
  return new NextRequest(new URL("http://localhost/api/allocator/scenario/saved"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: rawBody,
  });
}

function mkGet() {
  return new NextRequest(new URL("http://localhost/api/allocator/scenario/saved"), {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authShouldFail = false;
  rateLimitState = "allow";
  insertResult = { data: { id: "scen-1", name: "My scenario" }, error: null };
  listResult = { data: [], error: null };
  lastInsertPayload = null;
});

// ===========================================================================
// POST
// ===========================================================================

describe("POST /api/allocator/scenario/saved", () => {
  it("T_S1 — returns 401 when the allocator gate fails", async () => {
    authShouldFail = true;
    const res = await POST(mkPost({ name: "x", draft: VALID_DRAFT }));
    expect(res.status).toBe(401);
  });

  it("T_S2 — 400 on missing draft, and does NOT consume a rate-limit token", async () => {
    const res = await POST(mkPost({ name: "x" }));
    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
  });

  it("T_S3 — 400 on empty name, limiter not called", async () => {
    const res = await POST(mkPost({ name: "   ", draft: VALID_DRAFT }));
    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
  });

  it("T_S4 — 400 on name > 120 chars, limiter not called", async () => {
    const res = await POST(mkPost({ name: "a".repeat(121), draft: VALID_DRAFT }));
    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
  });

  it("T_S5 — 429 + Retry-After + Cache-Control when rate-limit denies", async () => {
    rateLimitState = "deny";
    const res = await POST(mkPost({ name: "x", draft: VALID_DRAFT }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_S6 — 503 + Retry-After when rate-limit misconfigured", async () => {
    rateLimitState = "misconfig";
    const res = await POST(mkPost({ name: "x", draft: VALID_DRAFT }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_S7 — 200 on success; insert fired against scenarios", async () => {
    const res = await POST(mkPost({ name: "My scenario", draft: VALID_DRAFT }));
    expect(res.status).toBe(200);
    expect(fromSpy).toHaveBeenCalledWith("scenarios");
    expect(checkLimitMock).toHaveBeenCalledTimes(1);
  });

  it("T_S8 — cross-tenant: a body-supplied allocator_id is IGNORED; insert uses user.id", async () => {
    const res = await POST(
      mkPost({
        name: "Hostile",
        draft: VALID_DRAFT,
        allocator_id: "alloc-OTHER",
      }),
    );
    expect(res.status).toBe(200);
    expect(lastInsertPayload).not.toBeNull();
    expect(lastInsertPayload!.allocator_id).toBe("alloc-A");
    // The forged field must not have leaked through.
    expect(lastInsertPayload!.allocator_id).not.toBe("alloc-OTHER");
    // schema_version is sourced from the draft, name from the body.
    expect(lastInsertPayload!.schema_version).toBe(2);
    expect(lastInsertPayload!.name).toBe("Hostile");
  });

  it("T_S9 — DB error returns the redacted stable message, NOT raw error.message", async () => {
    insertResult = {
      data: null,
      error: { code: "23505", message: 'duplicate key value violates "scenarios_pkey"' },
    };
    const res = await POST(mkPost({ name: "x", draft: VALID_DRAFT }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.message).toBe(
      "Couldn't save this scenario. Check your connection and try again.",
    );
    // The raw Postgres message must never reach the client.
    expect(JSON.stringify(json)).not.toContain("scenarios_pkey");
  });

  it("T_S10 — NO_STORE_HEADERS on success AND on error", async () => {
    const ok = await POST(mkPost({ name: "x", draft: VALID_DRAFT }));
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");

    insertResult = { data: null, error: { message: "boom" } };
    const err = await POST(mkPost({ name: "x", draft: VALID_DRAFT }));
    expect(err.headers.get("Cache-Control")).toBe("private, no-store");
  });

  // FIX A (HIGH, DoS / storage-poison) — an oversized raw body is rejected
  // with 413 BEFORE JSON.parse, WITHOUT writing (no insert) and WITHOUT
  // consuming a rate-limit token (the limiter fires after validation).
  it("T_S13 — oversized body → 413, no insert, no token consumed", async () => {
    // A raw string comfortably over the 256 KB cap. Doesn't even need to be
    // valid JSON — the byte-cap runs before parse.
    const oversized = "x".repeat(MAX_DRAFT_BODY_BYTES + 1);
    const res = await POST(mkPostRaw(oversized));
    expect(res.status).toBe(413);
    expect(fromSpy).not.toHaveBeenCalled(); // nothing written
    expect(checkLimitMock).not.toHaveBeenCalled(); // no token burned
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_S14 — a normal (under-cap) draft still saves", async () => {
    const res = await POST(mkPost({ name: "Normal", draft: VALID_DRAFT }));
    expect(res.status).toBe(200);
    expect(fromSpy).toHaveBeenCalledWith("scenarios");
  });

  it("T_S15 — a successful save emits a scenario.save audit event for the new id", async () => {
    insertResult = { data: { id: "scen-NEW", name: "Audited" }, error: null };
    const res = await POST(mkPost({ name: "Audited", draft: VALID_DRAFT }));
    expect(res.status).toBe(200);
    expect(logAuditEventMock).toHaveBeenCalledTimes(1);
    const [, event] = logAuditEventMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(event.action).toBe("scenario.save");
    expect(event.entity_type).toBe("scenario");
    expect(event.entity_id).toBe("scen-NEW");
    // Privacy: metadata carries NO draft contents — only schema_version + name length.
    expect(event.metadata).toEqual({ schema_version: 2, name_length: "Audited".length });
  });

  it("T_S16 — a FAILED save (DB error) does NOT emit an audit event", async () => {
    insertResult = { data: null, error: { message: "boom" } };
    const res = await POST(mkPost({ name: "x", draft: VALID_DRAFT }));
    expect(res.status).toBe(500);
    expect(logAuditEventMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// FIX A — schema-level draft caps (defense-in-depth; bounds the persisted blob)
// ===========================================================================
//
// The route's byte-cap (above) is the outer gate; scenarioDraftSchema's
// per-field `.max()` / entry-count caps are the inner gate that bounds the
// jsonb actually persisted. Pin BOTH ends: a realistic draft validates, an
// over-cap synthetic draft is rejected by safeParse (so the route never
// inserts it). Caps are far above any real portfolio, so this can only fail if
// a future edit removes or shrinks them below a legitimate draft.

describe("scenarioDraftSchema — FIX A entry-count / length caps", () => {
  it("accepts a realistic draft (well under every cap)", () => {
    expect(scenarioDraftSchema.safeParse(VALID_DRAFT).success).toBe(true);
  });

  it("rejects an over-cap toggleByScopeRef (synthetic mega-map)", () => {
    const huge: Record<string, boolean> = {};
    for (let i = 0; i < 2001; i++) huge[`holding:x:S${i}:spot`] = true;
    const bad = { ...VALID_DRAFT, toggleByScopeRef: huge };
    expect(scenarioDraftSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an over-cap addedStrategies array", () => {
    const many = Array.from({ length: 201 }, (_v, i) => ({
      id: `id-${i}`,
      name: `S${i}`,
      markets: [],
      strategy_types: [],
    }));
    const bad = { ...VALID_DRAFT, addedStrategies: many };
    expect(scenarioDraftSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an over-length init_holdings_fingerprint", () => {
    const bad = {
      ...VALID_DRAFT,
      init_holdings_fingerprint: "x".repeat(200_001),
    };
    expect(scenarioDraftSchema.safeParse(bad).success).toBe(false);
  });
});

// ===========================================================================
// GET
// ===========================================================================

describe("GET /api/allocator/scenario/saved", () => {
  it("T_S11 — 200; lists the caller's rows ordered updated_at desc", async () => {
    listResult = {
      data: [{ id: "scen-1", name: "A", schema_version: 2, created_at: "c", updated_at: "u" }],
      error: null,
    };
    const res = await GET(mkGet());
    expect(res.status).toBe(200);
    expect(fromSpy).toHaveBeenCalledWith("scenarios");
    // ordering is by updated_at desc (RLS scopes the rows to the caller).
    expect(orderSpy).toHaveBeenCalledWith(
      expect.stringContaining("id, name, schema_version, created_at, updated_at"),
      "updated_at",
      { ascending: false },
    );
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_S12 — GET DB error → redacted 500 + Cache-Control", async () => {
    listResult = { data: null, error: { message: 'relation "scenarios" does not exist' } };
    const res = await GET(mkGet());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("does not exist");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

// ===========================================================================
// Tenant-isolation client choice (static guard)
// ===========================================================================
//
// The GET list path has NO `.eq("allocator_id")` — tenant isolation relies
// ENTIRELY on RLS scoping the user-scoped client to `auth.uid()`. If a future
// edit swapped this route to a service-role (BYPASSRLS) client, every tenant's
// rows would leak with ALL of the behavioural tests above still green (they
// mock the client). Pin the client choice statically: the route must source the
// user-scoped client and must NOT import an admin / service-role client.

describe("scenario/saved route — tenant-isolation client choice", () => {
  const routeSrc = readFileSync(join(__dirname, "route.ts"), "utf8");

  it("imports the user-scoped client from @/lib/supabase/server", () => {
    expect(routeSrc).toContain('from "@/lib/supabase/server"');
  });

  it("does NOT import an admin / service-role client (RLS is the only tenant gate)", () => {
    // A BYPASSRLS client would silently leak every tenant — the list path has no
    // explicit .eq("allocator_id") backstop.
    expect(routeSrc).not.toContain("@/lib/supabase/admin");
    expect(routeSrc).not.toMatch(/service[_-]?role/i);
    expect(routeSrc).not.toContain("createServiceClient");
  });
});
