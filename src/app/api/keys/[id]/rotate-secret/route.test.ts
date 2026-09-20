/**
 * Phase 164.5.3 / MT5CREDS — PATCH /api/keys/[id]/rotate-secret.
 *
 * D-04's credential-update path: re-validate a NEW MT5 password against the
 * live broker BEFORE ever persisting, and clear the failure state (D-05)
 * ONLY on a validated, persisted success.
 *
 * Threat coverage (cross-link to 164.5.3-04-PLAN <threat_model>):
 *   - T-164.5.3-09 EoP        → admin-client UPDATE is ownership-scoped by an
 *                                explicit filter, pre-verified via a
 *                                user-scoped read
 *   - T-164.5.3-10 Tampering  → the request body can only ever carry
 *                                `new_secret` — no login, no broker server
 *   - T-164.5.3-11 Repudiation→ sync_error/disconnected_at clear ONLY inside
 *                                the same admin-UPDATE call a validated
 *                                success issues
 *   - T-164.5.3-12 Tampering  → venue-identity 23505 answers a distinct 409,
 *                                never the generic write-indeterminate 500
 *   - T-164.5.3-15 Info Disc. → one honest 404 for wrong-owner / unknown id
 *
 * Mock recorder pattern mirrors `strategies/[id]/name/route.test.ts` (the
 * user-scoped builder) and `keys/validate-and-encrypt/route.test.ts` (the
 * admin-client builder + ratelimit `importActual` extension).
 *
 * ⛔ Every credential-shaped value in this file is a synthetic placeholder —
 * never a real MT5 login, broker server, or password (CONTEXT.md's
 * non-negotiable rule; the repo is public and `.planning/` is tracked).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import type { AuthUser } from "@supabase/supabase-js";

const SYNTHETIC_NEW_SECRET = "synthetic-rotated-secret-9f2c";
const SYNTHETIC_LOGIN = "acct-test-0001";
const KEY_ID = "cccccccc-0001-4000-8000-000000000001";

const OWNER: AuthUser = {
  id: "00000000-0000-0000-0000-000000000aaa",
  app_metadata: { provider: "email" },
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00.000Z",
  email: "owner@quantalyze.test",
  role: "authenticated",
};
const FOREIGN_USER_ID = "00000000-0000-0000-0000-000000000bbb";

interface UpdateQuery {
  payload: Record<string, unknown>;
  filters: Array<{ column: string; value: unknown }>;
  columns: string | null;
}

interface ReadQuery {
  columns: string | null;
  filters: Array<{ column: string; value: unknown }>;
}

const {
  READ_STATE,
  ADMIN_STATE,
  USER_SCOPED_UPDATE_CALLS,
  mockResilientFetch,
  auditEvents,
  rateLimitResult,
  rateLimitCalls,
  csrfReturn,
} = vi.hoisted(() => ({
  READ_STATE: {
    /** The ownership+venue-shape row `.maybeSingle()` resolves to, or null. */
    row: {
      id: "cccccccc-0001-4000-8000-000000000001",
      user_id: "00000000-0000-0000-0000-000000000aaa",
      exchange: "mt5",
      venue_account_id: null as string | null,
    } as Record<string, unknown> | null,
    error: null as { message: string } | null,
    queries: [] as ReadQuery[],
  },
  ADMIN_STATE: {
    /** The `{ data, error }` the admin UPDATE chain resolves to. */
    result: { data: [{ id: "cccccccc-0001-4000-8000-000000000001" }], error: null } as {
      data: Array<Record<string, unknown>> | null;
      error: { code?: string; message: string } | null;
    },
    /**
     * WR-02 (164.5.3 review) — a per-call SEQUENCE, consumed one shift per
     * admin UPDATE. Empty by default, in which case `.result` above answers
     * EVERY call identically (unchanged pre-existing behaviour). A test that
     * wants the retry attempt to answer DIFFERENTLY from the first (e.g.
     * collide once, then succeed) pushes both outcomes here.
     */
    resultQueue: [] as Array<{
      data: Array<Record<string, unknown>> | null;
      error: { code?: string; message: string } | null;
    }>,
    updates: [] as UpdateQuery[],
    /** When set, `createAdminClient()` THROWS this. */
    factoryError: null as Error | null,
  },
  /**
   * MEDIUM (164.5.3 review) — the "source pins" vacuous-test replacement.
   * `@/lib/supabase/server`'s mock now exposes an `update` the pre-existing
   * mock never had, so the ONLY way to prove "the persist write used the
   * ADMIN client, never the user-scoped one" is to make the user-scoped path
   * OBSERVABLE and assert it stayed empty — not `SOURCE.toContain(…)` against
   * a string that survives in a comment.
   */
  USER_SCOPED_UPDATE_CALLS: [] as Array<Record<string, unknown>>,
  mockResilientFetch: vi.fn(),
  auditEvents: [] as Array<{ action: string; entity_type: string; entity_id: string }>,
  rateLimitResult: { success: true as boolean, retryAfter: 0 },
  rateLimitCalls: [] as string[],
  csrfReturn: { value: null as NextResponse | null },
}));

let currentUser: AuthUser | null = OWNER;

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => {
  interface Builder {
    eq(column: string, value: unknown): Builder;
    maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
  }
  function makeBuilder(columns: string): Builder {
    const query: ReadQuery = { columns, filters: [] };
    const builder: Builder = {
      eq(column: string, value: unknown) {
        query.filters.push({ column, value });
        return builder;
      },
      async maybeSingle() {
        READ_STATE.queries.push({ ...query, filters: [...query.filters] });
        return { data: READ_STATE.row, error: READ_STATE.error };
      },
    };
    return builder;
  }
  // MEDIUM (164.5.3 review) — a user-scoped `.update()` DID NOT EXIST on this
  // mock before. `api_keys` UPDATE is fully REVOKEd from `authenticated`
  // (D-07), so this arm exists ONLY to make that fact assertable: it records
  // the attempt to `USER_SCOPED_UPDATE_CALLS` and answers a 42501-shaped
  // error, mirroring what the REAL client would return — never a silent
  // success a route bug could hide behind.
  interface UpdateBuilder extends PromiseLike<{ data: null; error: unknown }> {
    eq(column: string, value: unknown): UpdateBuilder;
  }
  function makeUpdateBuilder(payload: Record<string, unknown>): UpdateBuilder {
    const builder: UpdateBuilder = {
      eq() {
        return builder;
      },
      then(onfulfilled, onrejected) {
        USER_SCOPED_UPDATE_CALLS.push({ ...payload });
        return Promise.resolve({
          data: null,
          error: { code: "42501", message: "permission denied for table api_keys" },
        }).then(onfulfilled, onrejected);
      },
    };
    return builder;
  }
  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: currentUser }, error: null }),
      },
      from: (_table: string) => ({
        select: (columns: string) => makeBuilder(columns),
        update: (payload: Record<string, unknown>) => makeUpdateBuilder(payload),
      }),
    }),
  };
});

vi.mock("@/lib/supabase/admin", () => {
  interface Builder extends PromiseLike<{ data: unknown; error: unknown }> {
    eq(column: string, value: unknown): Builder;
    select(columns: string): Builder;
  }
  function makeBuilder(payload: Record<string, unknown>): Builder {
    const filters: Array<{ column: string; value: unknown }> = [];
    let columns: string | null = null;
    const builder: Builder = {
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return builder;
      },
      select(cols: string) {
        columns = cols;
        return builder;
      },
      then(onfulfilled, onrejected) {
        ADMIN_STATE.updates.push({
          payload: { ...payload },
          filters: [...filters],
          columns,
        });
        const outcome =
          ADMIN_STATE.resultQueue.length > 0
            ? ADMIN_STATE.resultQueue.shift()!
            : ADMIN_STATE.result;
        return Promise.resolve(outcome).then(onfulfilled, onrejected);
      },
    };
    return builder;
  }
  return {
    createAdminClient: () => {
      if (ADMIN_STATE.factoryError) throw ADMIN_STATE.factoryError;
      return {
        from: (_table: string) => ({
          update: (payload: Record<string, unknown>) => makeBuilder(payload),
        }),
      };
    },
  };
});

// EXTENDED, NOT REPLACED (mirrors keys/validate-and-encrypt/route.test.ts):
// the pure builder helpers come from `importActual` so this mock cannot drift
// from the real 503-vs-429 decision.
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    userActionLimiter: null,
    checkLimit: async (_limiter: unknown, key: string) => {
      rateLimitCalls.push(key);
      if (rateLimitResult.success) return { success: true };
      return { success: false, retryAfter: rateLimitResult.retryAfter };
    },
    rateLimitDenyJson: actual.rateLimitDenyJson,
    isRateLimitMisconfigured: actual.isRateLimitMisconfigured,
  };
});

// EXTENDED, NOT REPLACED: SEAM_BUDGETS/SEAM_ROUTE_BUDGETS/CircuitOpenError/
// SeamBodyReadError all stay the REAL exports — only `resilientFetch` itself
// is replaced, so task 1's seam-registration assertions read the real table.
vi.mock("@/lib/resilient-fetch", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/resilient-fetch")>();
  return {
    ...actual,
    resilientFetch: mockResilientFetch,
  };
});

vi.mock("@/lib/audit", () => ({
  logAuditEvent: (
    _client: unknown,
    event: { action: string; entity_type: string; entity_id: string },
  ) => {
    auditEvents.push({
      action: event.action,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
    });
  },
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => csrfReturn.value,
}));

const INBOUND_CORRELATION_ID = "rotate-secret:11111111-1111-4111-8111-111111111111";
vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-correlation-id", INBOUND_CORRELATION_ID]]),
}));

import { PATCH, maxDuration } from "./route";

function makeReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/keys/${KEY_ID}/rotate-secret`, {
    method: "PATCH",
    headers: new Headers({
      "content-type": "application/json",
      origin: "http://localhost:3000",
    }),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function makeCtx(id: string = KEY_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** A seam response that resolves like `resilientFetch`'s real Response. */
function seamResponse(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: async () => body };
}

const SEAM_SUCCESS_BODY = {
  api_key_encrypted: "synthetic-ciphertext-blob-1",
  api_secret_encrypted: null,
  passphrase_encrypted: null,
  dek_encrypted: "synthetic-dek-1",
  nonce: "synthetic-nonce-1",
  kek_version: 1,
  venue_account_id: SYNTHETIC_LOGIN,
};

beforeEach(() => {
  currentUser = OWNER;
  READ_STATE.row = {
    id: KEY_ID,
    user_id: OWNER.id,
    exchange: "mt5",
    venue_account_id: null,
  };
  READ_STATE.error = null;
  READ_STATE.queries = [];
  ADMIN_STATE.result = { data: [{ id: KEY_ID }], error: null };
  ADMIN_STATE.resultQueue = [];
  ADMIN_STATE.updates = [];
  ADMIN_STATE.factoryError = null;
  USER_SCOPED_UPDATE_CALLS.length = 0;
  mockResilientFetch.mockReset();
  mockResilientFetch.mockResolvedValue(seamResponse(true, 200, SEAM_SUCCESS_BODY));
  auditEvents.length = 0;
  rateLimitResult.success = true;
  rateLimitResult.retryAfter = 0;
  rateLimitCalls.length = 0;
  csrfReturn.value = null;
});

describe("PATCH /api/keys/[id]/rotate-secret — the defended stack", () => {
  it("returns 403 and touches nothing when assertSameOrigin rejects", async () => {
    csrfReturn.value = NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(403);
    expect(READ_STATE.queries).toHaveLength(0);
    expect(mockResilientFetch).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no session", async () => {
    currentUser = null;
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body).toEqual({ code: "DASHBOARD_SIGNED_OUT", error: "unauthorized" });
  });

  it("returns 400 on a malformed id without touching the DB", async () => {
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(READ_STATE.queries).toHaveLength(0);
    expect(mockResilientFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing key", {}],
    ["a non-string", { new_secret: 42 }],
    ["null", { new_secret: null }],
    ["whitespace only", { new_secret: "   " }],
  ])("rejects %s with 400 NEW_SECRET_REQUIRED, no read, no seam call", async (_label, body) => {
    const res = await PATCH(makeReq(body), makeCtx());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      code: "NEW_SECRET_REQUIRED",
      error: "invalid secret",
    });
    expect(READ_STATE.queries).toHaveLength(0);
    expect(mockResilientFetch).not.toHaveBeenCalled();
  });

  it("D-03: the request body type carries no field for a login or broker server", () => {
    // Static proof, not a runtime one — a body with extra fields would simply
    // have them ignored, which does not prove the TYPE never names them.
    const src = readFileSync(join(process.cwd(), "src/app/api/keys/[id]/rotate-secret/route.ts"), "utf8");
    expect(src).toMatch(/interface RotateSecretBody \{\s*new_secret\?: unknown;\s*\}/);
  });
});

describe("PATCH /api/keys/[id]/rotate-secret — ownership + venue gate (never a live probe on a shape the route refuses)", () => {
  it("returns ONE honest 404 for a foreign owner — never distinguishing", async () => {
    READ_STATE.row = { id: KEY_ID, user_id: FOREIGN_USER_ID, exchange: "mt5", venue_account_id: null };
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ code: "DASHBOARD_ROW_STALE", error: "key not found" });
    expect(mockResilientFetch).not.toHaveBeenCalled();
    expect(ADMIN_STATE.updates).toHaveLength(0);
  });

  it("returns the BYTE-IDENTICAL 404 for an unknown id", async () => {
    READ_STATE.row = null;
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ code: "DASHBOARD_ROW_STALE", error: "key not found" });
    expect(mockResilientFetch).not.toHaveBeenCalled();
  });

  it("answers 400 KEY_UPDATE_UNSUPPORTED_VENUE for a non-MT5 key BEFORE any rate limit or seam call", async () => {
    READ_STATE.row = { id: KEY_ID, user_id: OWNER.id, exchange: "binance", venue_account_id: null };
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      code: "KEY_UPDATE_UNSUPPORTED_VENUE",
      error: "Only MT5 keys support password rotation.",
    });
    expect(rateLimitCalls).toHaveLength(0);
    expect(mockResilientFetch).not.toHaveBeenCalled();
    expect(ADMIN_STATE.updates).toHaveLength(0);
  });

  it("scopes the rate-limit key to keys-rotate-secret:{user.id}, AFTER ownership validation", async () => {
    await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(rateLimitCalls).toEqual([`keys-rotate-secret:${OWNER.id}`]);
  });

  it("returns 429 with Retry-After when the limiter is exhausted, never reaching the seam", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 30;
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(mockResilientFetch).not.toHaveBeenCalled();
  });

  it("CR-03: the 429 body carries code:RATE_LIMITED, not a bare {error} the dialog cannot classify", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 30;
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({
      code: "RATE_LIMITED",
      error: "Too many requests",
    });
  });
});

describe("PATCH /api/keys/[id]/rotate-secret — the happy path end-to-end", () => {
  it("issues the admin UPDATE with the exact ciphertext + status-clear payload and WHERE filters, then 200s", async () => {
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    expect(ADMIN_STATE.updates).toHaveLength(1);
    const update = ADMIN_STATE.updates[0];
    expect(update.filters).toEqual([
      { column: "id", value: KEY_ID },
      { column: "user_id", value: OWNER.id },
      { column: "exchange", value: "mt5" },
    ]);
    expect(update.columns).toBe("id");
    expect(update.payload).toEqual({
      api_key_encrypted: SEAM_SUCCESS_BODY.api_key_encrypted,
      api_secret_encrypted: SEAM_SUCCESS_BODY.api_secret_encrypted,
      passphrase_encrypted: SEAM_SUCCESS_BODY.passphrase_encrypted,
      dek_encrypted: SEAM_SUCCESS_BODY.dek_encrypted,
      nonce: SEAM_SUCCESS_BODY.nonce,
      kek_version: SEAM_SUCCESS_BODY.kek_version,
      sync_error: null,
      // CR-01: the third field `reconnect_allocator_api_key` clears — restores
      // fan-out eligibility, not just visibility.
      sync_status: "idle",
      // WR-03: disconnected_at is NEVER touched — every writer of it at HEAD
      // is the user-initiated Disconnect button, so clearing it here would
      // silently reconnect a deliberately parked key.
      // Pre-read venue_account_id was NULL — backfilled from the seam response.
      venue_account_id: SYNTHETIC_LOGIN,
    });
    expect(USER_SCOPED_UPDATE_CALLS).toHaveLength(0);
  });

  it("does NOT overwrite an existing venue_account_id", async () => {
    READ_STATE.row = { id: KEY_ID, user_id: OWNER.id, exchange: "mt5", venue_account_id: "already-set-acct" };
    await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(ADMIN_STATE.updates).toHaveLength(1);
    expect(ADMIN_STATE.updates[0].payload).not.toHaveProperty("venue_account_id");
  });

  it("audits a successful rotation as api_key.rotate_secret", async () => {
    await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(auditEvents).toEqual([
      { action: "api_key.rotate_secret", entity_type: "api_key", entity_id: KEY_ID },
    ]);
  });

  it("calls resilientFetch with the keys-rotate-secret budget key and retriesOverride:0", async () => {
    await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(mockResilientFetch).toHaveBeenCalledTimes(1);
    const [budgetKey, path, init] = mockResilientFetch.mock.calls[0];
    expect(budgetKey).toBe("keys-rotate-secret");
    expect(path).toBe(`/internal/keys/${KEY_ID}/rotate-secret`);
    expect(init).toMatchObject({ method: "POST", retriesOverride: 0 });
  });
});

describe("PATCH /api/keys/[id]/rotate-secret — seam registration (D-04)", () => {
  it("SEAM_BUDGETS declares keys-rotate-secret at 120s against the mt5-gateway dependency", async () => {
    const { SEAM_BUDGETS } = await import("@/lib/resilient-fetch");
    expect(SEAM_BUDGETS["keys-rotate-secret"]).toMatchObject({
      timeoutMs: 120_000,
      dependencies: ["mt5-gateway"],
    });
  });

  it("SEAM_ROUTE_BUDGETS declares this route at 300s with one keys-rotate-secret call", async () => {
    const { SEAM_ROUTE_BUDGETS } = await import("@/lib/resilient-fetch");
    expect(SEAM_ROUTE_BUDGETS["src/app/api/keys/[id]/rotate-secret/route.ts"]).toEqual({
      expectedMaxDurationS: 300,
      budgets: [{ key: "keys-rotate-secret", calls: 1 }],
    });
  });

  it("the route exports maxDuration=300, matching SEAM_ROUTE_BUDGETS", () => {
    expect(maxDuration).toBe(300);
  });
});

describe("PATCH /api/keys/[id]/rotate-secret — validation failure renders through ErrorEnvelope (D-04)", () => {
  it("an MT5_MASTER_PASSWORD seam failure answers the ErrorEnvelope contract at 400, persist step never reached", async () => {
    mockResilientFetch.mockResolvedValue(
      seamResponse(false, 400, {
        detail: "MT5 master password detected — an investor login is required.",
      }),
    );
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(400);
    const envelope = (await res.json()) as Record<string, unknown>;
    expect(envelope).toMatchObject({
      ok: false,
      code: "KEY_MT5_MASTER_PASSWORD",
      correlation_id: expect.any(String),
    });
    expect(typeof envelope.human_message).toBe("string");
    expect((envelope.human_message as string).length).toBeGreaterThan(0);
    expect(Array.isArray(envelope.debug_context)).toBe(true);
    // D-04: nothing is persisted on a failed validation.
    expect(ADMIN_STATE.updates).toHaveLength(0);
  });
});

describe("PATCH /api/keys/[id]/rotate-secret — WR-01: the seam's machine code reaches the classifier", () => {
  it("a Python-side RATE_LIMITED (the per-key rotation throttle, distinct from this route's own limiter) answers KEY_RATE_LIMIT at 503", async () => {
    mockResilientFetch.mockResolvedValue(
      seamResponse(false, 429, {
        detail: {
          code: "RATE_LIMITED",
          detail: "Too many secret-rotation attempts for this key. Try again in a moment.",
          retryable: true,
          retry_after: 60,
        },
      }),
    );
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(503);
    const envelope = (await res.json()) as Record<string, unknown>;
    expect(envelope.code).toBe("KEY_RATE_LIMIT");
    expect(ADMIN_STATE.updates).toHaveLength(0);
  });

  it("KEK_UNAVAILABLE answers SEAM_MISCONFIGURED at 500, not the terminal UNKNOWN", async () => {
    mockResilientFetch.mockResolvedValue(
      seamResponse(false, 500, {
        detail: {
          code: "KEK_UNAVAILABLE",
          detail: "Credential encryption is not configured. This needs an operator, not a retry.",
          retryable: false,
          dependency: "kek",
        },
      }),
    );
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(500);
    const envelope = (await res.json()) as Record<string, unknown>;
    expect(envelope.code).toBe("SEAM_MISCONFIGURED");
  });

  it("MT5_GATEWAY_UNCONFIGURED answers SEAM_INTERNAL_FAULT at 500, not the terminal UNKNOWN", async () => {
    mockResilientFetch.mockResolvedValue(
      seamResponse(false, 500, {
        detail: {
          code: "MT5_GATEWAY_UNCONFIGURED",
          detail: "The MetaTrader gateway is not configured. This needs an operator, not a retry.",
          retryable: false,
          dependency: "mt5-gateway",
        },
      }),
    );
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(500);
    const envelope = (await res.json()) as Record<string, unknown>;
    expect(envelope.code).toBe("SEAM_INTERNAL_FAULT");
  });

  it("a body with no code (the flat AUTH_FAILED_DETAIL shape) still falls through to the substring cascade unharmed", async () => {
    mockResilientFetch.mockResolvedValue(
      seamResponse(false, 400, {
        detail: "Authentication failed. Check your API key and secret.",
      }),
    );
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(400);
    const envelope = (await res.json()) as Record<string, unknown>;
    expect(envelope.code).toBe("KEY_AUTH_FAILED");
  });
});

describe("PATCH /api/keys/[id]/rotate-secret — D-05 / CR-01: clear the failure state ONLY on a validated success", () => {
  it("a FAILED validation never invokes the admin UPDATE — the DB-level status fields are untouched by construction", async () => {
    mockResilientFetch.mockResolvedValue(
      seamResponse(false, 400, { detail: "Authentication failed. Check your API key and secret." }),
    );
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(400);
    // The strongest available proof that nothing was cleared: this route
    // never issues a write on the failure path, so sync_error/sync_status
    // cannot have moved regardless of what they held before this request.
    expect(ADMIN_STATE.updates).toHaveLength(0);
  });

  it("a SUCCESSFUL validation clears sync_error AND restores sync_status='idle' in the SAME statement as the ciphertext write (CR-01)", async () => {
    await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(ADMIN_STATE.updates).toHaveLength(1);
    expect(ADMIN_STATE.updates[0].payload).toMatchObject({
      sync_error: null,
      sync_status: "idle",
      api_key_encrypted: SEAM_SUCCESS_BODY.api_key_encrypted,
    });
    // WR-03: disconnected_at is never part of the payload at all — asserted
    // as an absence, not merely an unmatched-object omission (toMatchObject
    // above would pass even if the key were present with a different value).
    // The route does not even SELECT this column (see the ownership read
    // above), so it has no way to reconnect a row it never inspected — the
    // strongest available proof that a deliberately-disconnected row cannot
    // be silently reconnected by a password fix.
    expect(ADMIN_STATE.updates[0].payload).not.toHaveProperty("disconnected_at");
  });
});

describe("PATCH /api/keys/[id]/rotate-secret — the venue-identity 23505 backstop (Pitfall 1 / WR-02)", () => {
  const VENUE_IDENTITY_23505 = {
    data: null,
    error: {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "api_keys_user_exchange_venue_account_uniq"',
    },
  };

  it("answers a distinct 409 KEY_VENUE_ALREADY_CONNECTED when the RETRY also collides, never the generic write-indeterminate arm", async () => {
    // Static `.result` (not a queue) answers BOTH the initial attempt and the
    // retry identically — the second collision case WR-02's fix documents.
    ADMIN_STATE.result = VENUE_IDENTITY_23505;
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      code: "KEY_VENUE_ALREADY_CONNECTED",
      error: "You already have a connected key for this account.",
    });
    // Both the backfill attempt and the no-backfill retry were tried.
    expect(ADMIN_STATE.updates).toHaveLength(2);
    expect(ADMIN_STATE.updates[0].payload).toHaveProperty("venue_account_id", SYNTHETIC_LOGIN);
    expect(ADMIN_STATE.updates[1].payload).not.toHaveProperty("venue_account_id");
  });

  it("WR-02: retries WITHOUT venue_account_id on a first-attempt collision, and the password fix + status clear still land", async () => {
    ADMIN_STATE.resultQueue = [
      VENUE_IDENTITY_23505,
      { data: [{ id: KEY_ID }], error: null },
    ];
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    expect(ADMIN_STATE.updates).toHaveLength(2);
    // Attempt 1: the backfill, which collided.
    expect(ADMIN_STATE.updates[0].payload).toMatchObject({
      venue_account_id: SYNTHETIC_LOGIN,
      sync_error: null,
      sync_status: "idle",
    });
    // Attempt 2 (the retry): SAME ciphertext + status clear, no
    // venue_account_id — the correction was not discarded by the collision.
    expect(ADMIN_STATE.updates[1].payload).not.toHaveProperty("venue_account_id");
    expect(ADMIN_STATE.updates[1].payload).toMatchObject({
      api_key_encrypted: SEAM_SUCCESS_BODY.api_key_encrypted,
      sync_error: null,
      sync_status: "idle",
    });
  });

  it("does NOT retry when the row already had a venue_account_id (nothing to drop)", async () => {
    READ_STATE.row = {
      id: KEY_ID,
      user_id: OWNER.id,
      exchange: "mt5",
      venue_account_id: "already-set-acct",
    };
    ADMIN_STATE.result = VENUE_IDENTITY_23505;
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(409);
    // A single attempt — retrying an identical payload could only reproduce
    // the same collision, so the route does not waste a round trip on it.
    expect(ADMIN_STATE.updates).toHaveLength(1);
  });

  it("a DIFFERENT 23505 (unrelated constraint) falls through to the generic write-indeterminate 500, no retry", async () => {
    ADMIN_STATE.result = {
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "some_other_constraint"',
      },
    };
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      code: "DASHBOARD_WRITE_INDETERMINATE",
      error: "internal error",
    });
    expect(ADMIN_STATE.updates).toHaveLength(1);
  });
});

describe("PATCH /api/keys/[id]/rotate-secret — write-outcome honesty", () => {
  it("zero updated rows after a validated seam success answers DASHBOARD_WRITE_INDETERMINATE, never a silent 200", async () => {
    ADMIN_STATE.result = { data: [], error: null };
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      code: "DASHBOARD_WRITE_INDETERMINATE",
      error: "internal error",
    });
  });

  it("a genuine transport/DB fault on the UPDATE answers its own distinct 500", async () => {
    ADMIN_STATE.result = { data: null, error: { message: "db down" } };
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      code: "DASHBOARD_WRITE_INDETERMINATE",
      error: "internal error",
    });
  });

  it("createAdminClient() throwing (no service credential) answers SEAM_MISCONFIGURED at 503", async () => {
    ADMIN_STATE.factoryError = new Error("Missing SUPABASE_SERVICE_ROLE_KEY for admin operations");
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      code: "SEAM_MISCONFIGURED",
      error: "Service credential unavailable",
    });
  });
});

describe("PATCH /api/keys/[id]/rotate-secret — MEDIUM: the body-parse catch never leaks a secret fragment", () => {
  it("a malformed body carrying a synthetic secret does not reach console.error, even as a fragment", async () => {
    // Mirrors the review's own measured repro shape and RE-VERIFIED it on
    // node v25.8.1 before writing this test:
    //   JSON.parse('[{"new_secret":"synthetic-leaky-secret-QZ9X4K"},]')
    //   throws `Unexpected token ']', ...""},]" is not valid JSON` — a
    // FRAGMENT of the secret's tail, and the FULL raw body is measurably NOT
    // a substring of that message (so a `scrubSeamError(err, [rawBody])`
    // fix — the naive reading of the review's first suggested remedy — would
    // NOT have caught this; only dropping the message entirely does).
    const SYNTHETIC_LEAKY_SECRET = "synthetic-leaky-secret-QZ9X4K";
    const malformed = `[{"new_secret":"${SYNTHETIC_LEAKY_SECRET}"},]`;
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await PATCH(makeReq(malformed), makeCtx());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      code: "DASHBOARD_REQUEST_INVALID",
      error: "invalid json",
    });

    const logged = consoleErr.mock.calls
      .map((args) => args.map((a) => String(a)).join(" "))
      .join("\n");
    expect(logged).toContain("body parse failed");
    // The error's TYPE — the fix's entire replacement for the message — is
    // still logged, so this pins "no leak", not "no diagnosis at all".
    expect(logged).toContain("SyntaxError");
    expect(logged).not.toContain(SYNTHETIC_LEAKY_SECRET);
    expect(logged).not.toContain(SYNTHETIC_LEAKY_SECRET.slice(-6));
    consoleErr.mockRestore();
  });
});

describe("PATCH /api/keys/[id]/rotate-secret — source pins", () => {
  const SOURCE = readFileSync(
    join(process.cwd(), "src/app/api/keys/[id]/rotate-secret/route.ts"),
    "utf8",
  );

  it("anti-vacuity: the source really loaded", () => {
    expect(SOURCE.length).toBeGreaterThan(500);
    expect(SOURCE).toContain("export async function PATCH");
  });

  it("never imports classifyKeyValidationError's substring cascade as a hand-rolled copy", () => {
    expect(SOURCE).toContain("classifyKeyValidationError");
    // A hand-rolled cascade would re-introduce the exact drift class
    // classifyKeyValidationError exists to close.
    expect(SOURCE).not.toMatch(/lower\.includes\(/);
  });

  it("uses the admin client for the persist write, never the user-scoped client (BEHAVIOURAL)", async () => {
    // MEDIUM (164.5.3 review) — `SOURCE.toContain("createAdminClient()")`
    // passes against a COMMENT mentioning that string; swapping the persist
    // call to the user-scoped `createClient()` would leave this test green.
    // Drive the real handler instead: the mock harness distinguishes
    // ADMIN_STATE (this file's admin builder) from USER_SCOPED_UPDATE_CALLS
    // (a NEW capability on the user-scoped mock, added for this fix, that
    // did not exist before — the persist write had no user-scoped `.update`
    // to even call by accident until now). Assert the write landed on the
    // former and never touched the latter.
    const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
    expect(res.status).toBe(200);
    expect(ADMIN_STATE.updates.length).toBeGreaterThan(0);
    expect(USER_SCOPED_UPDATE_CALLS).toHaveLength(0);
  });

  it("stamps NO_STORE_HEADERS on every response arm", () => {
    const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const responses = (CODE.match(/NextResponse\.json\(/g) ?? []).length;
    const stamps = (CODE.match(/NO_STORE_HEADERS/g) ?? []).length;
    expect(responses).toBeGreaterThan(0);
    expect(stamps).toBeGreaterThanOrEqual(responses);
  });
});
