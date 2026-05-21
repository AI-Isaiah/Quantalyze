import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 C-0115 — route-level coverage for the wizard-draft
 * /api/strategies/draft/[id] handlers.
 *
 * The route handles GET (resume a draft) and DELETE (user-initiated
 * "Delete draft" from the wizard chrome). Both are user-scoped and
 * inline-auth'd (not via withAuth) because they need the dynamic [id]
 * param off the App Router ctx.
 *
 * Pre-fix this route had ZERO co-located tests. A regression that broke
 * any of the following four guarantees would land silently:
 *   1. DELETE rejects a wrong-origin request with 403 (CSRF defense).
 *   2. Both verbs return 401 when the caller is unauthenticated.
 *   3. Both verbs return 404 (NOT 401/500) when the row exists but is
 *      not owned by the caller — RLS hides the row, and the route MUST
 *      surface that as "Draft not found" rather than leaking ownership
 *      info via a different status.
 *   4. Both verbs return 200 on the owner happy path.
 *
 * Test 3 (the not-owned case) deliberately models RLS: the user-scoped
 * Supabase client returns `data=null` when the .eq("user_id", userId)
 * filter excludes the row. That is the only signal the route gets that
 * the caller is not the owner — there is no distinct "not yours"
 * branch.
 */

vi.mock("server-only", () => ({}));

const STATE = vi.hoisted(() => ({
  // Auth: null means unauthenticated; otherwise the user id.
  user: null as { id: string } | null,
  // Strategy lookup result. null models RLS-hidden or absent row.
  draftRow: null as
    | { id: string; user_id: string; source: string; status: string; api_key_id: string | null }
    | null,
  // Captured DELETE filter chain (so we can confirm user_id scoping).
  strategiesDeleteCalls: [] as Array<{ column: string; value: unknown }>,
  // api_keys reference count returned by the head/select for cleanup.
  apiKeyRefCount: 1 as number,
  // Captured api_keys deletes (cleanup branch).
  apiKeysDeleteCalls: [] as Array<{ column: string; value: unknown }>,
  // Captured audit emissions.
  auditCalls: [] as Array<{ action: string; entity_id: unknown }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: STATE.user },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === "strategies") {
        // The route uses two chains:
        //   .select(...).eq().eq().maybeSingle()                  (GET, DELETE preflight)
        //   .select("id", {count:'exact', head:true}).eq(...)     (api_keys ref count)
        //   .delete().eq().eq().eq().eq()                          (DELETE)
        const buildSelectChain = () => ({
          eq: (_column: string, _value: unknown) => buildSelectChain(),
          maybeSingle: async () => ({ data: STATE.draftRow, error: null }),
          // Terminal for the ref-count head:true select.
          then: undefined,
        });
        const buildRefCountChain = () => ({
          eq: (_column: string, _value: unknown) => ({
            // The route awaits the .eq() chain directly — model that
            // by exposing a thenable that resolves to { count }.
            then: (resolve: (v: { count: number }) => void) =>
              resolve({ count: STATE.apiKeyRefCount }),
          }),
        });
        const buildDeleteChain = () => ({
          eq: (column: string, value: unknown) => {
            STATE.strategiesDeleteCalls.push({ column, value });
            // Last .eq() in the route's delete chain is awaited and
            // must resolve to { error: null }. Each intermediate .eq()
            // must keep returning a chainable thenable.
            return Object.assign(buildDeleteChain(), {
              then: (resolve: (v: { error: null }) => void) =>
                resolve({ error: null }),
            });
          },
        });
        return {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) return buildRefCountChain();
            return buildSelectChain();
          },
          delete: () => buildDeleteChain(),
        };
      }
      if (table === "api_keys") {
        const buildApiKeyDeleteChain = () => ({
          eq: (column: string, value: unknown) => {
            STATE.apiKeysDeleteCalls.push({ column, value });
            return {
              then: (resolve: (v: { error: null }) => void) =>
                resolve({ error: null }),
            };
          },
        });
        return {
          delete: () => buildApiKeyDeleteChain(),
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: (
    _client: unknown,
    event: { action: string; entity_id: unknown },
  ) => {
    STATE.auditCalls.push({ action: event.action, entity_id: event.entity_id });
  },
}));

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";
const API_KEY_ID = "44444444-4444-4444-8444-444444444444";

const VALID_ORIGIN = { origin: "http://localhost:3000" };

function makeGetReq(id = DRAFT_ID): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/strategies/draft/${id}`,
    { method: "GET", headers: VALID_ORIGIN },
  );
}

function makeDeleteReq(id = DRAFT_ID, origin = "http://localhost:3000"): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/strategies/draft/${id}`,
    { method: "DELETE", headers: { origin } },
  );
}

function makeCtx(id = DRAFT_ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  STATE.user = null;
  STATE.draftRow = null;
  STATE.strategiesDeleteCalls = [];
  STATE.apiKeyRefCount = 1;
  STATE.apiKeysDeleteCalls = [];
  STATE.auditCalls = [];
});

describe("DELETE /api/strategies/draft/[id] — CSRF defense (C-0115)", () => {
  it("returns 403 when the Origin header is from an unallowed host", async () => {
    // Authenticate + provision a real draft so we know the 403 is from
    // assertSameOrigin, not the auth / lookup branches downstream.
    STATE.user = { id: OWNER_ID };
    STATE.draftRow = {
      id: DRAFT_ID,
      user_id: OWNER_ID,
      source: "wizard",
      status: "draft",
      api_key_id: null,
    };

    const { DELETE } = await import("./route");
    const res = await DELETE(
      makeDeleteReq(DRAFT_ID, "https://evil.example.com"),
      makeCtx(),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    // CSRF responses use a stable shape — assert the error key is set.
    expect(body.error).toBeTruthy();

    // The DB delete chain must NOT have executed.
    expect(STATE.strategiesDeleteCalls.length).toBe(0);
    expect(STATE.auditCalls.length).toBe(0);
  });
});

describe("/api/strategies/draft/[id] — 401 unauthenticated (C-0115)", () => {
  it("GET returns 401 when the caller is unauthenticated", async () => {
    STATE.user = null;

    const { GET } = await import("./route");
    const res = await GET(makeGetReq(), makeCtx());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("DELETE returns 401 when the caller is unauthenticated", async () => {
    STATE.user = null;

    const { DELETE } = await import("./route");
    const res = await DELETE(makeDeleteReq(), makeCtx());

    expect(res.status).toBe(401);
    // No delete + no audit on the unauthenticated path.
    expect(STATE.strategiesDeleteCalls.length).toBe(0);
    expect(STATE.auditCalls.length).toBe(0);
  });
});

describe("/api/strategies/draft/[id] — 404 when not owned by caller (C-0115)", () => {
  // RLS hides the row from a user-scoped client when the
  // .eq("user_id", userId) filter excludes it. The route surfaces that
  // as "Draft not found" (404) — NOT a distinct 403, to avoid leaking
  // whether the draft id exists for someone else.
  it("GET returns 404 when the row is not owned by the caller", async () => {
    STATE.user = { id: OTHER_USER_ID };
    // draftRow stays null — that's what the user-scoped client returns
    // when RLS + .eq("user_id", OTHER_USER_ID) hides the row.
    STATE.draftRow = null;

    const { GET } = await import("./route");
    const res = await GET(makeGetReq(), makeCtx());

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Draft not found");
  });

  it("DELETE returns 404 when the row is not owned by the caller", async () => {
    STATE.user = { id: OTHER_USER_ID };
    STATE.draftRow = null;

    const { DELETE } = await import("./route");
    const res = await DELETE(makeDeleteReq(), makeCtx());

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Draft not found");
    // Critical: no DB mutation, no audit emission — a non-owner must
    // never trigger the strategies-delete or audit side effects.
    expect(STATE.strategiesDeleteCalls.length).toBe(0);
    expect(STATE.auditCalls.length).toBe(0);
  });
});

describe("/api/strategies/draft/[id] — 200 happy path for the owner (C-0115)", () => {
  it("GET returns 200 + draft body for the owner", async () => {
    STATE.user = { id: OWNER_ID };
    STATE.draftRow = {
      id: DRAFT_ID,
      user_id: OWNER_ID,
      source: "wizard",
      status: "draft",
      api_key_id: API_KEY_ID,
    };

    const { GET } = await import("./route");
    const res = await GET(makeGetReq(), makeCtx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft).toBeDefined();
    expect(body.draft.id).toBe(DRAFT_ID);
    expect(body.draft.user_id).toBe(OWNER_ID);
    expect(body.draft.source).toBe("wizard");
    expect(body.draft.status).toBe("draft");
  });

  it("DELETE returns 200 + emits strategy.delete audit for the owner", async () => {
    STATE.user = { id: OWNER_ID };
    STATE.draftRow = {
      id: DRAFT_ID,
      user_id: OWNER_ID,
      source: "wizard",
      status: "draft",
      // No linked api_key — keeps this test focused on the strategy
      // delete + audit. The api_keys cleanup branch is route-internal
      // and not part of the C-0115 contract.
      api_key_id: null,
    };

    const { DELETE } = await import("./route");
    const res = await DELETE(makeDeleteReq(), makeCtx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);

    // The strategies DELETE chain must have re-applied all four
    // filters (id + user_id + source + status) — the TOCTOU defense.
    const deleteColumns = STATE.strategiesDeleteCalls.map((c) => c.column);
    expect(deleteColumns).toContain("id");
    expect(deleteColumns).toContain("user_id");
    expect(deleteColumns).toContain("source");
    expect(deleteColumns).toContain("status");

    // Audit emission lands on the strategy.delete action with the
    // correct entity id — the forensic trail Sprint 6 Task 7.1b pins.
    expect(STATE.auditCalls.length).toBeGreaterThanOrEqual(1);
    const strategyDeleteAudit = STATE.auditCalls.find(
      (c) => c.action === "strategy.delete",
    );
    expect(strategyDeleteAudit).toBeDefined();
    expect(strategyDeleteAudit!.entity_id).toBe(DRAFT_ID);
  });
});
