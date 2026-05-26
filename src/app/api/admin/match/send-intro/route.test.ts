import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 cluster-E fix-loop — route-level coverage for
 * src/app/api/admin/match/send-intro/route.ts.
 *
 * Closes:
 *   H-0233 (route-level test stub)
 *   H-0237 (400 'original_strategy_id is required')
 *   H-0228 / H-0232 / M-0283 (rate-limit gate)
 *   H-0234 (kill-switch gate)
 *   H-0229 / M-0282 / C-0047 (original_strategy_id ownership check)
 *   M-0281 (original_strategy_id !== strategy_id)
 *   M-0280 (success:true parity)
 *   M-0284 (body-size cap)
 *   H-0231 (admin_note length cap)
 *   C-0049 (after() — verified by import + handler not throwing post-resp)
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const userState = vi.hoisted<{ current: { id: string } | null }>(() => ({
  current: null,
}));
const adminFlag = vi.hoisted(() => ({ isAdmin: false }));
const rateLimitState = vi.hoisted(() => ({
  allow: true,
  retryAfter: 30,
  misconfigured: false,
}));
const killSwitchState = vi.hoisted(() => ({
  enabled: true,
  errored: false,
}));
const portfolioState = vi.hoisted<{
  portfolioId: string | null;
  errored: boolean;
}>(() => ({
  portfolioId: "port-1",
  errored: false,
}));
const holdingsState = vi.hoisted<{
  valid: Set<string>;
  errored: boolean;
}>(() => ({
  valid: new Set<string>(["orig-1"]),
  errored: false,
}));
// audit-2026-05-07 fix-loop red-team (HIGH conf 8) — candidate_id IDOR
// check. Map candidate_id → allocator_id; when a candidate_id is provided
// to the route, the new ownership-check branch reads this state. Default
// allocator is "alloc-1" so existing tests that pass candidate_id=null are
// unaffected.
const candidateState = vi.hoisted<{
  valid: Map<string, string>;
  errored: boolean;
}>(() => ({
  valid: new Map<string, string>([["cand-1", "alloc-1"]]),
  errored: false,
}));
// NEW-C34-01 / NEW-C34-02: strategy validation state. Controls what the
// maybeSingle() lookup returns for the introduced strategy_id.
const strategyValidationState = vi.hoisted<{
  row: { id: string; user_id: string | null; status: string } | null;
  errored: boolean;
}>(() => ({
  row: { id: "strat-1", user_id: "mgr-1", status: "published" },
  errored: false,
}));
const rpcState = vi.hoisted<{
  data: unknown;
  error: unknown;
}>(() => ({
  data: [
    {
      contact_request_id: "cr-1",
      match_decision_id: "md-1",
      was_already_sent: false,
    },
  ],
  error: null,
}));
const auditCalls = vi.hoisted<Array<{ userId: string; event: unknown }>>(
  () => [],
);
const dispatchCalls = vi.hoisted<{ count: number }>(() => ({ count: 0 }));
const dispatchControl = vi.hoisted<{
  rejectAllocator: boolean;
}>(() => ({ rejectAllocator: false }));
const afterRan = vi.hoisted<{ ran: boolean; task: Promise<unknown> | null }>(
  () => ({ ran: false, task: null }),
);
// audit-2026-05-07 fix-loop red-team (MED conf 8) — record Sentry
// captures from dispatchAdminIntroEmails so the regression guard can
// assert a Resend rejection escalates beyond console.error.
const sentryCalls = vi.hoisted<
  Array<{ err: unknown; options: { tags: Record<string, string> } }>
>(() => []);
// audit-2026-05-07 fix-loop red-team (MED conf 8) — count fresh
// createAdminClient() calls so the regression guard can assert the
// after() task constructs its OWN client (not closure-captured).
const adminClientCalls = vi.hoisted<{ count: number }>(() => ({ count: 0 }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: userState.current },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => adminFlag.isAdmin,
}));

vi.mock("@/lib/ratelimit", () => ({
  adminActionLimiter: {},
  checkLimit: async () => {
    if (rateLimitState.allow) return { success: true };
    return rateLimitState.misconfigured
      ? {
          success: false,
          retryAfter: rateLimitState.retryAfter,
          reason: "ratelimit_misconfigured",
        }
      : {
          success: false,
          retryAfter: rateLimitState.retryAfter,
        };
  },
  isRateLimitMisconfigured: (
    rl: { success: boolean; reason?: string },
  ): boolean =>
    rl.success === false && rl.reason === "ratelimit_misconfigured",
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

vi.mock("@/lib/audit", () => ({
  logAuditEventAsUser: (
    _client: unknown,
    userId: string,
    event: unknown,
  ) => {
    auditCalls.push({ userId, event });
  },
}));

vi.mock("@/lib/email", () => ({
  notifyAllocatorOfAdminIntro: async () => {
    dispatchCalls.count += 1;
    if (dispatchControl.rejectAllocator) {
      throw new Error("resend-5xx");
    }
  },
  notifyManagerOfAdminIntro: async () => {
    dispatchCalls.count += 1;
  },
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, options: { tags: Record<string, string> }) => {
    sentryCalls.push({ err, options });
  },
}));

vi.mock("@/lib/manager-identity", () => ({
  loadManagerIdentity: async () => null,
}));

// next/server `after()` is the Vercel-blessed post-response hook. In tests
// we run the callback synchronously and mark afterRan so the test can
// assert the dispatch path was scheduled via `after()`, not the legacy
// `void` fire-and-forget shape (C-0049 regression guard).
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => unknown) => {
      afterRan.ran = true;
      // Don't await — `after()` is fire-and-forget by contract; we only
      // need to confirm the route called it. We DO expose the task
      // promise so tests that care about dispatch outcomes (e.g.
      // Sentry-on-rejection, fresh-admin-client-in-after) can await it.
      afterRan.task = Promise.resolve().then(cb);
      // Swallow rejections so the unhandled-rejection guard doesn't
      // explode in tests that intentionally make Resend reject.
      afterRan.task.catch(() => {});
    },
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    adminClientCalls.count += 1;
    return {
    from: (table: string) => {
      if (table === "system_flags") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                killSwitchState.errored
                  ? { data: null, error: { message: "boom" } }
                  : {
                      data: { enabled: killSwitchState.enabled },
                      error: null,
                    },
            }),
          }),
        };
      }
      if (table === "portfolios") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                portfolioState.errored
                  ? { data: null, error: { message: "pg-down" } }
                  : portfolioState.portfolioId
                  ? {
                      data: { id: portfolioState.portfolioId },
                      error: null,
                    }
                  : { data: null, error: null },
            }),
          }),
        };
      }
      if (table === "portfolio_strategies") {
        return {
          select: () => ({
            eq: () => ({
              eq: (_col: string, strategyId: string) => ({
                maybeSingle: async () =>
                  holdingsState.errored
                    ? { data: null, error: { message: "pg-down" } }
                    : holdingsState.valid.has(strategyId)
                    ? {
                        data: { strategy_id: strategyId },
                        error: null,
                      }
                    : { data: null, error: null },
              }),
            }),
          }),
        };
      }
      if (table === "match_candidates") {
        return {
          select: () => ({
            eq: (_col: string, candidateId: string) => ({
              maybeSingle: async () =>
                candidateState.errored
                  ? { data: null, error: { message: "pg-down" } }
                  : candidateState.valid.has(candidateId)
                  ? {
                      data: {
                        allocator_id: candidateState.valid.get(candidateId),
                      },
                      error: null,
                    }
                  : { data: null, error: null },
            }),
          }),
        };
      }
      if (table === "profiles") {
        // dispatchAdminIntroEmails reads allocator profile via .single().
        // Return a well-formed shape so the dispatch path reaches the
        // notifyAllocatorOfAdminIntro call (used by the Sentry-on-reject
        // regression test). Existing tests that don't await afterRan.task
        // are unaffected.
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  email: "allocator@example.com",
                  display_name: "Allocator Co",
                  company: "Allocator Co",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "strategies") {
        return {
          select: () => ({
            eq: (_col: string, _id: string) => ({
              // NEW-C34-01/C34-02: strategy validation uses .maybeSingle()
              maybeSingle: async () =>
                strategyValidationState.errored
                  ? { data: null, error: { message: "pg-down" } }
                  : { data: strategyValidationState.row, error: null },
              // dispatchAdminIntroEmails uses .single()
              single: async () => ({
                data: {
                  id: "strat-1",
                  name: "Test Strategy",
                  user_id: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
    rpc: async () => ({ data: rpcState.data, error: rpcState.error }),
    };
  },
}));

function makeReq(
  body: object = {
    allocator_id: "alloc-1",
    strategy_id: "strat-1",
    original_strategy_id: "orig-1",
    candidate_id: null,
    admin_note: "Welcome introduction note from the founder.",
  },
  opts: { contentLength?: number; rawBody?: string } = {},
): NextRequest {
  const serialized = opts.rawBody ?? JSON.stringify(body);
  const size =
    opts.contentLength ?? Buffer.byteLength(serialized, "utf8");
  return new NextRequest(
    "http://localhost:3000/api/admin/match/send-intro",
    {
      method: "POST",
      headers: {
        ...VALID_ORIGIN,
        "content-length": String(size),
        "content-type": "application/json",
      },
      body: serialized,
    },
  );
}

async function importRoute() {
  return await import("./route");
}

function resetState() {
  userState.current = { id: "admin-1" };
  adminFlag.isAdmin = true;
  rateLimitState.allow = true;
  rateLimitState.retryAfter = 30;
  rateLimitState.misconfigured = false;
  killSwitchState.enabled = true;
  killSwitchState.errored = false;
  portfolioState.portfolioId = "port-1";
  portfolioState.errored = false;
  holdingsState.valid = new Set<string>(["orig-1"]);
  holdingsState.errored = false;
  candidateState.valid = new Map<string, string>([["cand-1", "alloc-1"]]);
  candidateState.errored = false;
  strategyValidationState.row = { id: "strat-1", user_id: "mgr-1", status: "published" };
  strategyValidationState.errored = false;
  rpcState.data = [
    {
      contact_request_id: "cr-1",
      match_decision_id: "md-1",
      was_already_sent: false,
    },
  ];
  rpcState.error = null;
  auditCalls.length = 0;
  dispatchCalls.count = 0;
  afterRan.ran = false;
  afterRan.task = null;
  dispatchControl.rejectAllocator = false;
  sentryCalls.length = 0;
  adminClientCalls.count = 0;
}

describe("POST /api/admin/match/send-intro — auth + CSRF + RFC 7235 (P444)", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  it("returns 401 when unauthenticated (RFC 7235)", async () => {
    userState.current = null;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not admin", async () => {
    userState.current = { id: "user-1" };
    adminFlag.isAdmin = false;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/match/send-intro — rate limit (H-0228/H-0232/M-0283)", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  it("returns 429 with Retry-After when limiter denies", async () => {
    rateLimitState.allow = false;
    rateLimitState.retryAfter = 42;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("returns 503 when limiter is misconfigured (fail-CLOSED)", async () => {
    rateLimitState.allow = false;
    rateLimitState.misconfigured = true;
    rateLimitState.retryAfter = 60;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});

describe("POST /api/admin/match/send-intro — kill-switch (H-0234)", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  it("returns 503 when match_engine_enabled=false", async () => {
    killSwitchState.enabled = false;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.disabled).toBe(true);
  });

  // audit-2026-05-07 fix-loop red-team MED conf 8 — kill-switch must be a
  // HARD gate, not a hint. A transient pg / RLS error MUST fail-CLOSED
  // (503) so an attacker who can influence read errors (replica lag,
  // planner permission misconfig) can't route around the kill switch.
  // Pre-fix this returned 200 (fail-OPEN); post-fix returns 503 with a
  // distinct "could not be verified" message (no `disabled:true` flag,
  // because the state is unknown, not known-disabled).
  it("fails CLOSED with 503 when system_flags read errors (red-team MED conf 8)", async () => {
    killSwitchState.errored = true;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/could not be verified/);
    // `disabled:true` is reserved for the known-disabled branch.
    expect(body.disabled).toBeUndefined();
  });
});

describe("POST /api/admin/match/send-intro — body shape validation", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  it("returns 400 on missing allocator_id", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      makeReq({
        strategy_id: "strat-1",
        original_strategy_id: "orig-1",
        admin_note: "x",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/allocator_id/);
  });

  it("returns 400 on missing strategy_id", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        original_strategy_id: "orig-1",
        admin_note: "x",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/strategy_id/);
  });

  it("returns 400 on missing original_strategy_id (H-0237)", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        admin_note: "x",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/original_strategy_id/);
  });

  it("returns 400 on missing admin_note", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        original_strategy_id: "orig-1",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/admin_note/);
  });

  it("returns 400 when admin_note exceeds length cap (H-0231)", async () => {
    const { POST } = await importRoute();
    const longNote = "x".repeat(4001);
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        original_strategy_id: "orig-1",
        admin_note: longNote,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/maximum length/);
  });

  it("returns 400 when original_strategy_id === strategy_id (M-0281)", async () => {
    const { POST } = await importRoute();
    holdingsState.valid = new Set<string>(["strat-1"]);
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        original_strategy_id: "strat-1",
        admin_note: "x",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/differ/);
  });

  it("returns 413 when content-length exceeds cap (M-0284)", async () => {
    const { POST } = await importRoute();
    const req = makeReq(undefined, { contentLength: 64_000 });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  // audit-2026-05-07 fix-loop red-team MED conf 8 — Content-Length is
  // attacker-controlled. Number('bogus') === NaN and NaN > MAX is false,
  // so the CL cap is disabled by sending a non-numeric header. The
  // post-text() byte-length check is what actually enforces the cap.
  // This regression guard sends an oversized body with a bogus CL header
  // and asserts 413.
  it("returns 413 when actual body exceeds cap even with bogus Content-Length (red-team)", async () => {
    const oversized = JSON.stringify({
      allocator_id: "alloc-1",
      strategy_id: "strat-1",
      original_strategy_id: "orig-1",
      candidate_id: null,
      admin_note: "x".repeat(40_000),
    });
    const req = new NextRequest(
      "http://localhost:3000/api/admin/match/send-intro",
      {
        method: "POST",
        headers: {
          ...VALID_ORIGIN,
          "content-length": "bogus",
          "content-type": "application/json",
        },
        body: oversized,
      },
    );
    const { POST } = await importRoute();
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("returns 413 when actual body exceeds cap with Content-Length omitted (red-team)", async () => {
    const oversized = JSON.stringify({
      allocator_id: "alloc-1",
      strategy_id: "strat-1",
      original_strategy_id: "orig-1",
      candidate_id: null,
      admin_note: "x".repeat(40_000),
    });
    const req = new NextRequest(
      "http://localhost:3000/api/admin/match/send-intro",
      {
        method: "POST",
        headers: {
          ...VALID_ORIGIN,
          "content-type": "application/json",
        },
        body: oversized,
      },
    );
    const { POST } = await importRoute();
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  // audit-2026-05-07 cluster-E Phase-2 fix (testing M conf 9) — guard the
  // try/catch wrapper around JSON.parse(bodyText) in the req.text() →
  // byte-length cap → parse chain. A malformed body must surface as 400
  // "Invalid request body", not a 5xx unhandled rejection.
  it("returns 400 on malformed JSON body", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq(undefined, { rawBody: "{not-json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid request body/);
  });

  // audit-2026-05-07 cluster-E Phase-2 fix (testing M conf 9) — guard the
  // `!raw || typeof raw !== "object" || Array.isArray(raw)` check against
  // JSON values that parse successfully but aren't a plain object (array,
  // null, primitive).
  it("returns 400 when body is a JSON array", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq(undefined, { rawBody: "[]" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON object/);
  });

  it("returns 400 when body is JSON null", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq(undefined, { rawBody: "null" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON object/);
  });

  // audit-2026-05-07 cluster-E Phase-2 fix (testing M conf 9) — guard the
  // candidate_id type-narrowing branch (`rawBody.candidate_id !== undefined
  // && !== null && typeof !== "string" → 400`) against non-string non-null
  // values. The empty-string coercion test below pins a different code path.
  it("returns 400 when candidate_id is a non-string non-null value", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        original_strategy_id: "orig-1",
        candidate_id: 42,
        admin_note: "x",
      } as unknown as object),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(
      /candidate_id must be a string or null/,
    );
  });

  // audit-2026-05-07 cluster-E Phase-2 fix (testing M conf 8) — pin the
  // documented Content-Length-missing behavior. The route intentionally
  // falls through when CL is absent/zero/NaN so legitimate small payloads
  // still parse; this test locks that contract so a future "fix" to match
  // a stricter comment doesn't silently 411/413 every well-formed call.
  it("falls through to body validation when Content-Length header is absent", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/admin/match/send-intro",
      {
        method: "POST",
        headers: {
          ...VALID_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          allocator_id: "alloc-1",
          strategy_id: "strat-1",
          original_strategy_id: "orig-1",
          candidate_id: null,
          admin_note: "Welcome introduction note from the founder.",
        }),
      },
    );
    const { POST } = await importRoute();
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/match/send-intro — holdings RBAC (H-0229/M-0282/C-0047)", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  it("returns 400 when original_strategy_id is not in allocator holdings", async () => {
    holdingsState.valid = new Set<string>(); // none
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/current holdings/);
  });

  it("returns 400 when allocator has no portfolio", async () => {
    portfolioState.portfolioId = null;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no portfolio/);
  });

  // audit-2026-05-07 cluster-E Phase-2 fix (testing M conf 8) — guard the
  // portfolios-lookup DB error branch (`portfolioErr → 500 "Failed to verify
  // allocator portfolio"`). Only the null-row branch was tested previously;
  // a future change to the error envelope would silently regress without
  // this regression test.
  it("returns 500 when portfolio lookup errors", async () => {
    portfolioState.errored = true;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/verify allocator portfolio/);
  });

  // audit-2026-05-07 cluster-E Phase-2 fix (testing M conf 8) — guard the
  // portfolio_strategies-lookup DB error branch (`holdingErr → 500 "Failed
  // to verify allocator holdings"`). Only the null-row branch was tested
  // previously.
  it("returns 500 when holdings lookup errors", async () => {
    holdingsState.errored = true;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/verify allocator holdings/);
  });
});

describe("POST /api/admin/match/send-intro — after() lifetime + Sentry (red-team MED conf 8)", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  // audit-2026-05-07 fix-loop red-team MED conf 8 — after-client lifetime.
  // dispatchAdminIntroEmails must construct its OWN admin client inside
  // the after() task, not capture the request-scoped one via closure
  // (which can be torn down before the dispatch runs on Fluid Compute).
  // Pre-fix: 1 createAdminClient() call total (request scope) and the
  // closure-captured one was passed to dispatchAdminIntroEmails.
  // Post-fix: 2 createAdminClient() calls — one for the request handler,
  // one inside the after() task.
  it("constructs a fresh admin client inside the after() task", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(afterRan.ran).toBe(true);
    // Wait for the after() callback to complete so the second
    // createAdminClient() call has landed.
    await afterRan.task;
    expect(adminClientCalls.count).toBeGreaterThanOrEqual(2);
  });

  // audit-2026-05-07 fix-loop red-team MED conf 8 — silent zero-email
  // window. A Resend rejection during after() must escalate beyond
  // console.error so the founder sees a Sentry alert rather than
  // discovering the failure via "why didn't the allocator reply".
  it("escalates Resend rejection to Sentry (not just console.error)", async () => {
    dispatchControl.rejectAllocator = true;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(afterRan.task).not.toBeNull();
    await afterRan.task;
    // Allocator email rejected → exactly one Sentry capture with the
    // recipient tag set to "allocator".
    expect(sentryCalls.length).toBeGreaterThanOrEqual(1);
    const allocatorCapture = sentryCalls.find(
      (c) => c.options.tags.recipient === "allocator",
    );
    expect(allocatorCapture).toBeDefined();
    expect(allocatorCapture!.options.tags.route).toBe(
      "admin/match/send-intro",
    );
    expect(allocatorCapture!.options.tags.phase).toBe("dispatch");
  });
});

describe("POST /api/admin/match/send-intro — candidate_id IDOR (red-team HIGH conf 8)", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  // audit-2026-05-07 fix-loop red-team HIGH conf 8 — candidate_id forwarded
  // to the RPC WITHOUT an ownership check would let an admin pass a
  // candidate_id from another allocator's match_batches, corrupting
  // bridge_outcomes lineage. The new check rejects 400 when the candidate
  // row's allocator_id does not match body.allocator_id.
  it("returns 400 when candidate_id belongs to a different allocator", async () => {
    candidateState.valid = new Map<string, string>([
      ["cand-other", "alloc-other"],
    ]);
    const { POST } = await importRoute();
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        original_strategy_id: "orig-1",
        candidate_id: "cand-other",
        admin_note: "x",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not belong/);
  });

  it("returns 400 when candidate_id is unknown (fabricated UUID)", async () => {
    candidateState.valid = new Map<string, string>();
    const { POST } = await importRoute();
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        original_strategy_id: "orig-1",
        candidate_id: "cand-ghost",
        admin_note: "x",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not belong/);
  });

  it("returns 500 when candidate lookup errors", async () => {
    candidateState.errored = true;
    const { POST } = await importRoute();
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        original_strategy_id: "orig-1",
        candidate_id: "cand-1",
        admin_note: "x",
      }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/verify candidate/);
  });

  it("succeeds when candidate_id is owned by the named allocator", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        original_strategy_id: "orig-1",
        candidate_id: "cand-1",
        admin_note: "x",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("skips the candidate check when candidate_id is null", async () => {
    // Pre-fix the route would still proceed; this regression guard pins that
    // a null candidate_id does NOT hit the match_candidates lookup (which
    // would error since `null` is not a valid id).
    candidateState.errored = true; // would 500 if the check ran
    const { POST } = await importRoute();
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        original_strategy_id: "orig-1",
        candidate_id: null,
        admin_note: "x",
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/match/send-intro — success path", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  it("returns 200 + success:true + dispatches via after() (M-0280 / C-0049)", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.contact_request_id).toBe("cr-1");
    expect(body.match_decision_id).toBe("md-1");
    expect(body.was_already_sent).toBe(false);
    // Confirms `after()` (not `void`) is the dispatch entrypoint —
    // pre-fix this was a `void` call that Vercel could discard at
    // response-flush time (C-0049 regression guard).
    expect(afterRan.ran).toBe(true);
  });

  it("passes was_already_sent:true through and skips dispatch", async () => {
    rpcState.data = [
      {
        contact_request_id: "cr-1",
        match_decision_id: "md-1",
        was_already_sent: true,
      },
    ];
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.was_already_sent).toBe(true);
    // After-hook should NOT have been scheduled when nothing new to dispatch.
    expect(afterRan.ran).toBe(false);
  });

  it("emits intro.send audit with contact_request_id as entity_id", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0].userId).toBe("admin-1");
    const event = auditCalls[0].event as {
      action: string;
      entity_type: string;
      entity_id: string;
      metadata: Record<string, unknown>;
    };
    expect(event.action).toBe("intro.send");
    expect(event.entity_type).toBe("contact_request");
    expect(event.entity_id).toBe("cr-1");
    // metadata records length, not raw note (privacy/size).
    expect(event.metadata.admin_note_length).toBe(
      "Welcome introduction note from the founder.".length,
    );
    expect(event.metadata).not.toHaveProperty("admin_note");
  });

  it("returns 500 when RPC fails", async () => {
    rpcState.error = { message: "rpc broke" };
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
  });

  // audit-2026-05-07 fix-loop red-team MED conf 8 — emit intro.send_failed
  // on RPC error so a 500-storm is forensically visible. Pre-fix the
  // RPC error path returned 500 with NO audit row.
  it("emits intro.send_failed audit when RPC fails (red-team MED conf 8)", async () => {
    rpcState.error = { message: "rpc broke", code: "P0001" };
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    expect(auditCalls.length).toBe(1);
    const event = auditCalls[0].event as {
      action: string;
      entity_type: string;
      entity_id: string;
      metadata: Record<string, unknown>;
    };
    expect(event.action).toBe("intro.send_failed");
    expect(event.entity_type).toBe("strategy");
    expect(event.entity_id).toBe("strat-1");
    expect(event.metadata.allocator_id).toBe("alloc-1");
    expect(event.metadata.error_code).toBe("P0001");
    // contact_request_id is NOT part of the failure metadata (no row created).
    expect(event.metadata).not.toHaveProperty("contact_request_id");
  });

  it("normalizes empty-string candidate_id to null (red-team conf 8)", async () => {
    // Capture the RPC payload by tapping into the shared rpcState.
    // The mocked admin client's rpc() resolver doesn't expose arguments,
    // so instead we assert via the audit metadata, which records
    // candidate_id verbatim from the typed `body` object after coercion.
    const { POST } = await importRoute();
    const res = await POST(
      makeReq({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        original_strategy_id: "orig-1",
        candidate_id: "",
        admin_note: "x",
      }),
    );
    expect(res.status).toBe(200);
    expect(auditCalls.length).toBe(1);
    const meta = (auditCalls[0].event as { metadata: Record<string, unknown> })
      .metadata;
    expect(meta.candidate_id).toBeNull();
  });
});

/**
 * NEW-C34-01 (red-team H conf=8): strategy_id must have status='published'
 * before the RPC. The route bypasses RLS via the service-role admin client,
 * so it must enforce the status gate explicitly.
 *
 * NEW-C34-02 (red-team H conf=8): strategy_id existence and manager ownership
 * must be validated before the RPC to prevent corrupted bridge_outcomes lineage.
 *
 * NEW-C34-03 (red-team M conf=8): was_already_sent must emit "intro.resend_noop"
 * not "intro.send" to avoid fabricated fresh-send audit records.
 */
describe("NEW-C34-01/C34-02 — strategy_id validation before RPC send", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  it("returns 400 strategy_not_found when strategy_id does not exist", async () => {
    strategyValidationState.row = null;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("strategy_not_found");
    // RPC must NOT have been called — no contact_request_id in response
    expect(body.contact_request_id).toBeUndefined();
  });

  it("returns 400 strategy_not_published when strategy status is 'withdrawn'", async () => {
    strategyValidationState.row = { id: "strat-1", user_id: "mgr-1", status: "withdrawn" };
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("strategy_not_published");
    expect(body.error).toContain("withdrawn");
  });

  it("returns 400 strategy_not_published when strategy status is 'draft'", async () => {
    strategyValidationState.row = { id: "strat-1", user_id: "mgr-1", status: "draft" };
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("strategy_not_published");
  });

  it("returns 400 strategy_no_manager when strategy has no user_id", async () => {
    strategyValidationState.row = { id: "strat-1", user_id: null, status: "published" };
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("strategy_no_manager");
  });

  it("returns 500 when strategy lookup errors", async () => {
    strategyValidationState.errored = true;
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/verify strategy/i);
  });

  it("passes through to RPC when strategy is published with a manager", async () => {
    // Happy path: published strategy with manager must reach the RPC.
    strategyValidationState.row = { id: "strat-1", user_id: "mgr-1", status: "published" };
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contact_request_id).toBe("cr-1");
  });
});

describe("NEW-C34-03 — was_already_sent emits intro.resend_noop not intro.send", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  it("emits intro.resend_noop with note_applied=false when was_already_sent=true", async () => {
    rpcState.data = [
      {
        contact_request_id: "cr-existing",
        match_decision_id: "md-existing",
        was_already_sent: true,
      },
    ];
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.was_already_sent).toBe(true);
    expect(body.note_applied).toBe(false);
    // Must emit resend_noop, NOT intro.send
    expect(auditCalls.length).toBe(1);
    const event = auditCalls[0].event as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(event.action).toBe("intro.resend_noop");
    expect(event.metadata.note_applied).toBe(false);
    expect(event.metadata).not.toHaveProperty("was_already_sent");
  });

  it("emits intro.send (not intro.resend_noop) when was_already_sent=false", async () => {
    rpcState.data = [
      {
        contact_request_id: "cr-1",
        match_decision_id: "md-1",
        was_already_sent: false,
      },
    ];
    const { POST } = await importRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note_applied).toBe(true);
    expect(auditCalls.length).toBe(1);
    const event = auditCalls[0].event as { action: string };
    expect(event.action).toBe("intro.send");
  });
});
