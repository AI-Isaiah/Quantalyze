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
  // H-0314: inject an error on the api_keys ref-count head/select. When
  // set, the mock resolves { count: null, error } — exactly what
  // PostgREST returns on a failed count query. The route must treat this
  // as "cannot prove the key is orphaned" and SKIP the api_keys delete,
  // not coalesce null→0 and yank a key sibling strategies still share.
  apiKeyRefCountError: null as { message: string } | null,
  // Captured api_keys deletes (cleanup branch).
  apiKeysDeleteCalls: [] as Array<{ column: string; value: unknown }>,
  // H-0312: inject a failure on the api_keys delete to exercise the
  // non-fatal cleanup branch (the route warns + still returns 200).
  apiKeysDeleteError: null as { message: string } | null,
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
            // The route awaits the .eq() chain directly — model that by
            // exposing a thenable that resolves to { count, error }. On a
            // PostgREST count failure `count` comes back null alongside the
            // error, so when an error is injected we force count→null to
            // faithfully reproduce the null-coalesce hazard the route guards.
            then: (
              resolve: (v: {
                count: number | null;
                error: { message: string } | null;
              }) => void,
            ) =>
              resolve({
                count: STATE.apiKeyRefCountError ? null : STATE.apiKeyRefCount,
                error: STATE.apiKeyRefCountError,
              }),
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
              then: (
                resolve: (v: { error: { message: string } | null }) => void,
              ) => resolve({ error: STATE.apiKeysDeleteError }),
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
  STATE.apiKeyRefCountError = null;
  STATE.apiKeysDeleteCalls = [];
  STATE.apiKeysDeleteError = null;
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

// ============================================================
// H-0312 — DELETE api_keys conditional cleanup (refCount fence) +
//          non-fatal cleanup-failure branch.
//
// The DELETE handler hard-deletes the linked api_keys row ONLY when no
// other strategy still references it (refCount === 0). Otherwise the FK's
// ON DELETE SET NULL would silently break another strategy sharing the
// same key. A regression that dropped the refCount guard would orphan
// a sibling strategy's credentials; one that treated the api_keys delete
// failure as fatal would 500 a delete whose primary effect already
// succeeded. These tests pin both contracts.
// ============================================================
describe("DELETE /api/strategies/draft/[id] — api_keys cleanup (H-0312)", () => {
  it("hard-deletes the linked api_keys row when refCount === 0", async () => {
    STATE.user = { id: OWNER_ID };
    STATE.draftRow = {
      id: DRAFT_ID,
      user_id: OWNER_ID,
      source: "wizard",
      status: "draft",
      api_key_id: API_KEY_ID,
    };
    STATE.apiKeyRefCount = 0; // no other strategy references the key

    const { DELETE } = await import("./route");
    const res = await DELETE(makeDeleteReq(), makeCtx());

    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);

    // The api_keys delete fired, scoped to the linked key id.
    expect(STATE.apiKeysDeleteCalls).toContainEqual({
      column: "id",
      value: API_KEY_ID,
    });
    // The forensic record shows the cascade revoke.
    const revokeAudit = STATE.auditCalls.find(
      (c) => c.action === "api_key.revoke",
    );
    expect(revokeAudit).toBeDefined();
    expect(revokeAudit!.entity_id).toBe(API_KEY_ID);
  });

  it("does NOT delete the api_keys row when another strategy still references it (refCount > 0)", async () => {
    STATE.user = { id: OWNER_ID };
    STATE.draftRow = {
      id: DRAFT_ID,
      user_id: OWNER_ID,
      source: "wizard",
      status: "draft",
      api_key_id: API_KEY_ID,
    };
    STATE.apiKeyRefCount = 2; // a sibling strategy shares the key

    const { DELETE } = await import("./route");
    const res = await DELETE(makeDeleteReq(), makeCtx());

    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);

    // Critical: the shared key must survive — deleting it would NULL out
    // the sibling strategy's credentials via ON DELETE SET NULL.
    expect(STATE.apiKeysDeleteCalls.length).toBe(0);
    const revokeAudit = STATE.auditCalls.find(
      (c) => c.action === "api_key.revoke",
    );
    expect(revokeAudit).toBeUndefined();
  });

  it("does NOT delete the api_keys row when the ref-count query itself errors (H-0314)", async () => {
    // The ref-count query is the ONLY signal that decides whether the
    // linked key is orphaned. If it errors, `count` is null. A naive
    // `(count ?? 0) === 0` would coalesce that to 0 and DELETE the key —
    // even if sibling strategies still reference it — silently NULLing
    // their api_key_id via ON DELETE SET NULL and breaking their sync.
    // The route must treat a failed ref-count as "cannot prove orphaned"
    // and skip the delete entirely. Without the fix this test fails:
    // the delete fires and the revoke audit is emitted off a null count.
    STATE.user = { id: OWNER_ID };
    STATE.draftRow = {
      id: DRAFT_ID,
      user_id: OWNER_ID,
      source: "wizard",
      status: "draft",
      api_key_id: API_KEY_ID,
    };
    STATE.apiKeyRefCountError = { message: "ref-count query blew up" };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { DELETE } = await import("./route");
    const res = await DELETE(makeDeleteReq(), makeCtx());

    // The strategy row is already gone — the request still succeeds.
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);

    // CRITICAL: the api_keys delete must NOT have fired. A possibly-shared
    // key cannot be revoked on the strength of an errored (null) count.
    expect(STATE.apiKeysDeleteCalls.length).toBe(0);
    // And no revoke audit — nothing was revoked.
    const revokeAudit = STATE.auditCalls.find(
      (c) => c.action === "api_key.revoke",
    );
    expect(revokeAudit).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("treats an api_keys delete failure as non-fatal — still returns 200", async () => {
    STATE.user = { id: OWNER_ID };
    STATE.draftRow = {
      id: DRAFT_ID,
      user_id: OWNER_ID,
      source: "wizard",
      status: "draft",
      api_key_id: API_KEY_ID,
    };
    STATE.apiKeyRefCount = 0;
    STATE.apiKeysDeleteError = { message: "api_keys delete blew up" };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { DELETE } = await import("./route");
    const res = await DELETE(makeDeleteReq(), makeCtx());

    // The strategy row is already gone; a dangling api_key is a cosmetic
    // cleanup issue, NOT a request failure.
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
    // The delete was attempted...
    expect(STATE.apiKeysDeleteCalls).toContainEqual({
      column: "id",
      value: API_KEY_ID,
    });
    // ...but failed, so the revoke audit must NOT have been emitted.
    const revokeAudit = STATE.auditCalls.find(
      (c) => c.action === "api_key.revoke",
    );
    expect(revokeAudit).toBeUndefined();
    warnSpy.mockRestore();
  });
});

// ============================================================
// H-0318 — GET source/status filter: a non-wizard or non-draft row must
// 404 ("Not a wizard draft"), so the wizard's Resume banner can never be
// fed a pending_review / approved / legacy-draft strategy and clobber a
// published one. The route's GET does the source/status check AFTER the
// ownership lookup, in-handler (route.ts:79-81).
// ============================================================
describe("GET /api/strategies/draft/[id] — source/status fence (H-0318)", () => {
  it("returns 404 'Not a wizard draft' when the row is status='pending_review'", async () => {
    STATE.user = { id: OWNER_ID };
    STATE.draftRow = {
      id: DRAFT_ID,
      user_id: OWNER_ID,
      source: "wizard",
      status: "pending_review", // promoted past draft
      api_key_id: null,
    };

    const { GET } = await import("./route");
    const res = await GET(makeGetReq(), makeCtx());

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Not a wizard draft");
  });

  it("returns 404 'Not a wizard draft' when the row's source is not 'wizard' (legacy draft)", async () => {
    STATE.user = { id: OWNER_ID };
    STATE.draftRow = {
      id: DRAFT_ID,
      user_id: OWNER_ID,
      source: "manual", // legacy / non-wizard origin
      status: "draft",
      api_key_id: null,
    };

    const { GET } = await import("./route");
    const res = await GET(makeGetReq(), makeCtx());

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Not a wizard draft");
  });
});
