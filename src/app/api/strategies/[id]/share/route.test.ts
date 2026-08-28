/**
 * Phase 164 / Plan 164-03 / SHARE-01 — POST /api/strategies/[id]/share.
 *
 * Threat coverage (cross-link to 164-03-PLAN <threat_model>):
 *   - T-164-03 Info-disclosure → a non-owner and an unknown id get the SAME 404,
 *                                and neither reaches the RPC
 *   - T-164-08 Tampering/EoP   → the ownership probe carries the tenant predicate
 *                                on the wire, not merely "RLS would have caught it"
 *   - T-164-13 Info-disclosure → no audit metadata, and no client-visible error
 *                                envelope, ever carries the token
 *   - T-164-14 DoS             → the limiter is consumed AFTER validation (B15)
 *   - T-164-21 EoP             → ⭐ THE ROUND-TRIP. A minted url is fed back
 *                                through `verifyShareToken`, so a stale
 *                                two-argument pre-image cannot pass. Asserting a
 *                                43-character base64url token proves SHAPE only,
 *                                and shape is exactly what the wrong pre-image
 *                                would still have produced.
 *
 * ⛔ `@/lib/strategy-share-token` IS NOT MOCKED, deliberately. It is the thing
 * under test at the seam: mocking it would leave the route free to call
 * `deriveShareToken` with the wrong arity and every assertion here would still
 * pass. `src/test-setup.ts` supplies the `SHARE_TOKEN_SECRET` fixture the module
 * demands at module scope.
 *
 * The mock-recorder shape mirrors `src/app/api/strategies/[id]/ownership/route.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { PostgrestError } from "@supabase/supabase-js";
import type { AuthUser } from "@supabase/supabase-js";

interface RecordedQuery {
  table: string;
  columns: string | null;
  filters: Array<{ column: string; value: unknown }>;
  terminal: "maybeSingle" | "await";
}

function makePgError(message: string, code = "P0001"): PostgrestError {
  return new PostgrestError({ message, details: "", hint: "", code });
}

const recorders = vi.hoisted(() => ({
  user: null as AuthUser | null,
  queries: [] as Array<{
    table: string;
    columns: string | null;
    filters: Array<{ column: string; value: unknown }>;
    terminal: "maybeSingle" | "await";
  }>,
  /** What the ownership probe resolves to. */
  probeResult: {
    data: null as Record<string, unknown> | null,
    error: null as PostgrestError | null,
  },
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  /**
   * The RPC's answer. A FUNCTION of the call index so the reuse pin can be
   * neutered by returning a bumped generation on the second call — the
   * RED-demonstration the plan requires.
   */
  rpcResult: null as
    | ((callIndex: number) => {
        data: Array<Record<string, unknown>> | null;
        error: PostgrestError | null;
      })
    | null,
  /** Anything the route tries to write directly — must stay empty forever. */
  writeCalls: [] as Array<{ table: string; op: string }>,
  auditEvents: [] as Array<{
    action: string;
    entity_type: string;
    entity_id: string;
    metadata: Record<string, unknown> | undefined;
  }>,
  rateLimitCalls: [] as string[],
  rateLimitResult: { success: true } as
    | { success: true }
    | { success: false; retryAfter: number; reason?: string },
  csrfReturn: null as NextResponse | null,
  sentryCaptures: [] as Array<{ message: string; tags?: Record<string, string> }>,
  consoleErrors: [] as unknown[][],
}));

vi.mock("@/lib/supabase/server", () => {
  interface Builder {
    select(columns: string): Builder;
    eq(column: string, value: unknown): Builder;
    maybeSingle(): Promise<{
      data: Record<string, unknown> | null;
      error: PostgrestError | null;
    }>;
  }

  function makeBuilder(table: string): Builder {
    const query: RecordedQuery = {
      table,
      columns: null,
      filters: [],
      terminal: "await",
    };
    const builder: Builder = {
      select(columns: string) {
        query.columns = columns;
        return builder;
      },
      eq(column: string, value: unknown) {
        query.filters.push({ column, value });
        return builder;
      },
      maybeSingle() {
        query.terminal = "maybeSingle";
        recorders.queries.push({ ...query, filters: [...query.filters] });
        return Promise.resolve(recorders.probeResult);
      },
    };
    return builder;
  }

  /** Present ONLY so a route reaching for a direct write is RECORDED and fails
   *  the pin loudly, rather than throwing an opaque TypeError. */
  const recordWrite = (table: string, op: string) => {
    recorders.writeCalls.push({ table, op });
    return makeBuilder(table);
  };

  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: recorders.user }, error: null }),
      },
      from: (table: string) => ({
        select: (columns: string) => makeBuilder(table).select(columns),
        insert: () => recordWrite(table, "insert"),
        update: () => recordWrite(table, "update"),
        upsert: () => recordWrite(table, "upsert"),
        delete: () => recordWrite(table, "delete"),
      }),
      rpc: (fn: string, args: Record<string, unknown>) => {
        const callIndex = recorders.rpcCalls.length;
        recorders.rpcCalls.push({ fn, args });
        const make =
          recorders.rpcResult ?? (() => ({ data: null, error: null }));
        return Promise.resolve(make(callIndex));
      },
    }),
  };
});

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => recorders.csrfReturn,
}));

// `importOriginal` keeps the PURE helper `isRateLimitMisconfigured` real — a
// hand-written stub of it is how a route's 503 arm silently becomes a 429
// (the SEAMRIM-05 lesson recorded in src/lib/ratelimit.ts).
vi.mock("@/lib/ratelimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratelimit")>();
  return {
    ...actual,
    userActionLimiter: { __mock: "limiter" },
    checkLimit: async (_limiter: unknown, key: string) => {
      recorders.rateLimitCalls.push(key);
      return recorders.rateLimitResult;
    },
  };
});

vi.mock("@/lib/audit", () => ({
  logAuditEvent: (
    _client: unknown,
    event: {
      action: string;
      entity_type: string;
      entity_id: string;
      metadata?: Record<string, unknown>;
    },
  ) => {
    recorders.auditEvents.push({
      action: event.action,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      metadata: event.metadata,
    });
  },
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (
    err: unknown,
    opts?: { tags?: Record<string, string> },
  ) => {
    recorders.sentryCaptures.push({
      message: err instanceof Error ? err.message : String(err),
      tags: opts?.tags,
    });
  },
}));

import { POST } from "./route";
import { verifyShareToken } from "@/lib/strategy-share-token";

const VALID_USER: AuthUser = {
  id: "00000000-0000-0000-0000-000000000aaa",
  app_metadata: { provider: "email" },
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00.000Z",
  email: "owner@quantalyze.test",
  role: "authenticated",
};

const STRATEGY_ID = "cccccccc-0001-4000-8000-000000000001";
const NONCE = "eeeeeeee-0001-4000-8000-0000000000ff";
const GENERATION = 7;
const APP_URL = "https://quantalyze.test";
const ROUTE_SRC = readFileSync(join(__dirname, "route.ts"), "utf8");

function makeReq(): NextRequest {
  return new NextRequest(
    `${APP_URL}/api/strategies/${STRATEGY_ID}/share`,
    {
      method: "POST",
      headers: new Headers({ origin: APP_URL }),
    },
  );
}

function makeCtx(id: string = STRATEGY_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** The caller owns the strategy. */
function seedOwned(): void {
  recorders.probeResult = { data: { id: STRATEGY_ID }, error: null };
}

/**
 * The RPC's normal answer: ONE row, TWO columns, delivered as the row ARRAY
 * PostgREST produces for a `RETURNS TABLE` function. The SAME pair on every
 * call — which is what `ON CONFLICT DO UPDATE SET revoked_at = NULL` does in
 * the database, since it touches neither column.
 */
function seedMint(): void {
  recorders.rpcResult = () => ({
    data: [{ generation: GENERATION, nonce: NONCE }],
    error: null,
  });
}

/** Pull the 43-char token back out of a minted url. */
function tokenFrom(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

let originalAppUrl: string | undefined;

beforeEach(() => {
  originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  recorders.user = VALID_USER;
  recorders.queries = [];
  recorders.probeResult = { data: null, error: null };
  recorders.rpcCalls = [];
  recorders.rpcResult = null;
  recorders.writeCalls = [];
  recorders.auditEvents = [];
  recorders.rateLimitCalls = [];
  recorders.rateLimitResult = { success: true };
  recorders.csrfReturn = null;
  recorders.sentryCaptures = [];
  recorders.consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    recorders.consoleErrors.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

describe("POST /api/strategies/[id]/share — B15 ordering and the refusal arms", () => {
  it("returns the CSRF refusal and touches nothing", async () => {
    recorders.csrfReturn = NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403 },
    );
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(403);
    expect(res).toBe(recorders.csrfReturn);
    expect(recorders.queries).toHaveLength(0);
    expect(recorders.rateLimitCalls).toHaveLength(0);
    expect(recorders.rpcCalls).toHaveLength(0);
  });

  it("returns 401 with no session, and burns no limiter token", async () => {
    recorders.user = null;
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(recorders.rateLimitCalls).toHaveLength(0);
    expect(recorders.rpcCalls).toHaveLength(0);
  });

  it("returns 400 for a malformed id BEFORE the limiter (B15) and never mints", async () => {
    const res = await POST(makeReq(), makeCtx("not-a-uuid"));
    expect(res.status).toBe(400);
    // The B15 pin: a rejected id must not cost the caller one of their own
    // five-per-minute tokens.
    expect(recorders.rateLimitCalls).toHaveLength(0);
    expect(recorders.queries).toHaveLength(0);
    expect(recorders.rpcCalls).toHaveLength(0);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("returns 429 with Retry-After when the limiter denies", async () => {
    recorders.rateLimitResult = { success: false, retryAfter: 42 };
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(recorders.rateLimitCalls).toEqual([
      `strategy-share-mint:${VALID_USER.id}`,
    ]);
    expect(recorders.rpcCalls).toHaveLength(0);
  });

  it("returns 503 — never a lying 429 — when the limiter is MISCONFIGURED", async () => {
    recorders.rateLimitResult = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(recorders.rpcCalls).toHaveLength(0);
  });
});

describe("POST /api/strategies/[id]/share — ownership (T-164-03, T-164-08)", () => {
  it("answers 404 (NOT 403) for a strategy the caller does not own, and never mints", async () => {
    recorders.probeResult = { data: null, error: null };
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(404);
    // No existence oracle: the body says nothing about whether the row exists
    // for another tenant.
    await expect(res.json()).resolves.toEqual({ error: "strategy not found" });
    expect(recorders.rpcCalls).toHaveLength(0);
    expect(recorders.auditEvents).toHaveLength(0);
  });

  it("carries the tenant predicate ON THE WIRE, not merely in RLS", async () => {
    seedOwned();
    seedMint();
    await POST(makeReq(), makeCtx());
    expect(recorders.queries).toHaveLength(1);
    const probe = recorders.queries[0];
    expect(probe.table).toBe("strategies");
    expect(probe.terminal).toBe("maybeSingle");
    expect(probe.filters).toEqual([
      { column: "id", value: STRATEGY_ID },
      { column: "user_id", value: VALID_USER.id },
    ]);
  });

  it("redacts a probe failure — no DB message reaches the client", async () => {
    recorders.probeResult = {
      data: null,
      error: makePgError('relation "strategies" does not exist', "42P01"),
    };
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("relation");
    expect(body).not.toContain("42P01");
    expect(recorders.sentryCaptures).toHaveLength(1);
    expect(recorders.rpcCalls).toHaveLength(0);
  });
});

describe("POST /api/strategies/[id]/share — the mint (SHARE-01)", () => {
  beforeEach(() => {
    seedOwned();
    seedMint();
  });

  it("calls create_strategy_share with the id ALONE — never generation or nonce", async () => {
    await POST(makeReq(), makeCtx());
    expect(recorders.rpcCalls).toEqual([
      { fn: "create_strategy_share", args: { p_strategy_id: STRATEGY_ID } },
    ]);
    // The trigger and the column grants force both values regardless of the
    // caller; naming either here is the mistake the migration exists to make
    // impossible, and it must not creep back in at the route.
    const args = recorders.rpcCalls[0].args;
    expect(Object.keys(args)).toEqual(["p_strategy_id"]);
  });

  it("never writes strategy_shares directly — the RPC is the only writer", async () => {
    await POST(makeReq(), makeCtx());
    expect(recorders.writeCalls).toEqual([]);
    // Belt-and-braces at the SOURCE: a future direct write would have to name
    // the table, and `authenticated` holds no grant on `nonce` at all.
    expect(ROUTE_SRC).not.toMatch(/\.from\(\s*["']strategy_shares["']/);
  });

  it("returns a url on the recipient lane carrying a 43-char base64url token", async () => {
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url.startsWith(`${APP_URL}/factsheet-share/`)).toBe(true);
    expect(tokenFrom(url)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("⭐ ROUND-TRIPS: the minted token VERIFIES against (id, nonce, generation)", async () => {
    // ⛔ THE ASSERTION THAT CATCHES THE CLASS. The shape check above passes for
    // ANY 32-byte HMAC, including one over the stale two-argument pre-image the
    // plan originally specified — which would fail on the recipient route and
    // read to the owner as "this link was revoked" (T-164-21). Feeding the url
    // back through the real verifier is what proves the PRE-IMAGE, not just the
    // encoding.
    const res = await POST(makeReq(), makeCtx());
    const { url } = (await res.json()) as { url: string };
    expect(verifyShareToken(tokenFrom(url), STRATEGY_ID, NONCE, GENERATION)).toBe(
      true,
    );
  });

  it("⭐ is NOT the nonce-less two-argument digest (the stale pre-image, T-164-21)", async () => {
    // Constructed here rather than imported, because the two-argument form no
    // longer exists in the module — this is what the route WOULD have emitted
    // had it been built to the plan as written.
    const staleDigest = createHmac(
      "sha256",
      process.env.SHARE_TOKEN_SECRET as string,
    )
      .update(`qz.strategy-share.v1.${STRATEGY_ID}.${GENERATION}`)
      .digest("base64url");
    const res = await POST(makeReq(), makeCtx());
    const { url } = (await res.json()) as { url: string };
    expect(tokenFrom(url)).not.toBe(staleDigest);
    // …and the stale digest is 43 chars too, which is precisely why the shape
    // assertion could never have caught this.
    expect(staleDigest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("⭐ REUSE: two sequential mints return BYTE-IDENTICAL urls (the founder-hit bug)", async () => {
    // The regression pin for the defect this route exists to avoid. The
    // scenario-share skeleton revokes-and-remints on every call, so a verbatim
    // port would return a DIFFERENT url here and silently kill the recipient's
    // existing link. Reuse holds by construction: the RPC's reactivation path
    // is `ON CONFLICT (strategy_id) DO UPDATE SET revoked_at = NULL`, which
    // touches neither `nonce` nor `generation`, so the mock returning the same
    // pair twice IS the database's behaviour.
    const first = (await (await POST(makeReq(), makeCtx())).json()) as {
      url: string;
    };
    const second = (await (await POST(makeReq(), makeCtx())).json()) as {
      url: string;
    };
    expect(second.url).toBe(first.url);
    expect(recorders.rpcCalls).toHaveLength(2);
  });

  it("audits the mint with the GENERATION only — never the token (T-164-13)", async () => {
    const res = await POST(makeReq(), makeCtx());
    const { url } = (await res.json()) as { url: string };
    const token = tokenFrom(url);

    expect(recorders.auditEvents).toEqual([
      {
        action: "strategy.share.mint",
        entity_type: "strategy",
        entity_id: STRATEGY_ID,
        metadata: { generation: GENERATION },
      },
    ]);
    // The audit row is not a secret store. Serialize the WHOLE event and prove
    // the bearer credential is nowhere in it.
    expect(JSON.stringify(recorders.auditEvents)).not.toContain(token);
    // Nor is it in anything we logged or shipped to Sentry.
    expect(JSON.stringify(recorders.consoleErrors)).not.toContain(token);
    expect(JSON.stringify(recorders.sentryCaptures)).not.toContain(token);
  });
});

describe("POST /api/strategies/[id]/share — the RPC failure arms", () => {
  beforeEach(seedOwned);

  it("redacts an RPC error and emits no audit event", async () => {
    recorders.rpcResult = () => ({
      data: null,
      error: makePgError(
        'permission denied for column "nonce" of relation strategy_shares',
        "42501",
      ),
    });
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("nonce");
    expect(body).not.toContain("42501");
    expect(recorders.auditEvents).toHaveLength(0);
    expect(recorders.sentryCaptures).toHaveLength(1);
  });

  it("FAILS LOUD rather than minting from an empty row set", async () => {
    // A token derived from `undefined` is still a well-formed 43-char string
    // that verifies against nothing — a Copy Link that hands the owner a dead
    // URL with no error anywhere. 500 instead.
    recorders.rpcResult = () => ({ data: [], error: null });
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(500);
    expect(recorders.auditEvents).toHaveLength(0);
    expect(recorders.sentryCaptures).toHaveLength(1);
  });

  it("FAILS LOUD when the row is missing the nonce", async () => {
    recorders.rpcResult = () => ({
      data: [{ generation: GENERATION }],
      error: null,
    });
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(500);
    expect(recorders.auditEvents).toHaveLength(0);
  });
});

describe("POST /api/strategies/[id]/share — source pins", () => {
  it("keeps the RPC call in the shape the audit law can SEE — on ONE line", () => {
    // `src/__tests__/audit-coverage.test.ts` tests its `MUTATING_RPC_RE`
    // (`\.rpc\(\s*['"]create_strategy_share['"]`) against ONE LINE AT A TIME
    // (`findRpcMutations`, :264-269). Two independent things therefore hide
    // this mutation from the audit law, and BOTH were measured on 2026-08-28
    // by deleting the route's `logAuditEvent` and re-running that suite:
    //   (a) casting the METHOD rather than the client — the scenario-share
    //       precedent — erases the literal entirely; and
    //   (b) a Prettier-style wrap between `.rpc(` and the function name, which
    //       still reads as a normal call but splits the regex across lines.
    // With either in place the deletion left audit-coverage GREEN. With the
    // client cast AND the single-line call, the same deletion turns it RED.
    // That is what makes `create_strategy_share`'s entry in MUTATING_RPC_NAMES
    // more than decorative (the SEC-03 lesson recorded beside the entry).
    const rpcLine = ROUTE_SRC.split("\n").find((l) =>
      /\.rpc\(\s*["']create_strategy_share["']/.test(l),
    );
    expect(rpcLine).toBeDefined();
  });

  it("never names generation or nonce as a write target", () => {
    expect(ROUTE_SRC).not.toContain("p_generation");
    expect(ROUTE_SRC).not.toContain("p_nonce");
    expect(ROUTE_SRC).not.toMatch(/\.(insert|upsert|update)\(/);
  });
});
