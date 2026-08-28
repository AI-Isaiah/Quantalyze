/**
 * Phase 164 / Plan 164-03 / SHARE-03 — POST /api/strategies/[id]/share/revoke.
 *
 * Threat coverage (cross-link to 164-03-PLAN <threat_model>):
 *   - T-164-03 Info-disclosure → ⭐ THE NO-ORACLE PIN. A double-revoke and a
 *                                non-owner's revoke produce BYTE-IDENTICAL 404
 *                                responses — same status, same body, same
 *                                headers — because both come from one branch.
 *   - T-164-08 Tampering/EoP   → the RPC is the only writer, and it is called
 *                                with the id ALONE
 *   - T-164-11 Repudiation     → the kill is audited, and only on the arm that
 *                                actually revoked a row
 *   - T-164-14 DoS             → the limiter is consumed AFTER validation (B15)
 *
 * ⛔ N2 SOURCE PIN. The route must contain no `FOR UPDATE`, no retry loop and
 * no advisory lock. That is a founder ruling on measured evidence, not a
 * preference: the RPC's `revoked_at IS NULL` guard IS what makes a concurrent
 * double-revoke converge, and the remedy the corpus originally prescribed would
 * have removed it and created a counter-inflation bug. A source assertion is
 * the only detector for "somebody added the thing we were told not to add".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { PostgrestError } from "@supabase/supabase-js";
import type { AuthUser } from "@supabase/supabase-js";

function makePgError(message: string, code = "P0001"): PostgrestError {
  return new PostgrestError({ message, details: "", hint: "", code });
}

const recorders = vi.hoisted(() => ({
  user: null as AuthUser | null,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: null as number | string | null, error: null as PostgrestError | null },
  /** Any direct PostgREST chain the route reaches for — must stay empty. */
  tableCalls: [] as string[],
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
  sentryCaptures: [] as string[],
  consoleErrors: [] as unknown[][],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: recorders.user }, error: null }),
    },
    // Present ONLY so a route reaching for a direct table write is RECORDED
    // and fails the pin loudly rather than throwing an opaque TypeError. The
    // generation bump cannot be expressed by a client library, so any use of
    // this is a regression toward a non-atomic read-modify-write.
    from: (table: string) => {
      recorders.tableCalls.push(table);
      throw new Error(`unexpected direct table access: ${table}`);
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      recorders.rpcCalls.push({ fn, args });
      return Promise.resolve(recorders.rpcResult);
    },
  }),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => recorders.csrfReturn,
}));

// `importOriginal` keeps the PURE helper `isRateLimitMisconfigured` real — a
// hand-written stub is how a 503 arm silently becomes a 429 (SEAMRIM-05).
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
  captureToSentry: (err: unknown) => {
    recorders.sentryCaptures.push(
      err instanceof Error ? err.message : String(err),
    );
  },
}));

import { POST } from "./route";

const VALID_USER: AuthUser = {
  id: "00000000-0000-0000-0000-000000000aaa",
  app_metadata: { provider: "email" },
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00.000Z",
  email: "owner@quantalyze.test",
  role: "authenticated",
};

/** The caller's own strategy. */
const STRATEGY_ID = "cccccccc-0001-4000-8000-000000000001";
/** A strategy belonging to somebody else — RLS makes the RPC affect 0 rows. */
const FOREIGN_STRATEGY_ID = "cccccccc-0002-4000-8000-000000000002";
const APP_URL = "https://quantalyze.test";
const ROUTE_SRC = readFileSync(join(__dirname, "route.ts"), "utf8");

/**
 * ROUTE_SRC with comments removed.
 *
 * ⚠️ The N2 pin below scans for the constructs the founder ruling forbids, and
 * the route's own docblock NAMES them in order to forbid them — so a raw-text
 * scan makes the file its own offender (MEASURED: the first version of this
 * suite failed on the prohibition comment itself). The `strategies/[id]/name`
 * route hit the same trap from the other side and worked around it by
 * describing the forbidden filter without spelling it, because the sweep that
 * catches it is repo-wide and cannot be given a stripper. Here the scan is
 * local, so stripping is the honest fix: the DOCBLOCK SHOULD say what is
 * banned, and only the CODE has to be clean.
 *
 * Naive stripper — it would also truncate a line at a `//` inside a string
 * literal. This route contains none (no URL literals), and a mis-strip could
 * only DELETE text, i.e. make a pin pass vacuously; the "one line" pin below
 * runs against the RAW source, so a stripper regression cannot hide the one
 * assertion that has to see real code.
 */
const ROUTE_CODE = ROUTE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /\/\/[^\n]*/g,
  "",
);

function makeReq(id: string = STRATEGY_ID): NextRequest {
  return new NextRequest(
    `${APP_URL}/api/strategies/${id}/share/revoke`,
    { method: "POST", headers: new Headers({ origin: APP_URL }) },
  );
}

function makeCtx(id: string = STRATEGY_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** A full snapshot of a response, for the byte-identity comparison. */
async function snapshot(res: NextResponse): Promise<string> {
  const headers = [...res.headers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `${res.status}\n${headers}\n${await res.text()}`;
}

beforeEach(() => {
  recorders.user = VALID_USER;
  recorders.rpcCalls = [];
  recorders.rpcResult = { data: null, error: null };
  recorders.tableCalls = [];
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
});

describe("POST /api/strategies/[id]/share/revoke — B15 ordering and refusals", () => {
  it("returns the CSRF refusal and touches nothing", async () => {
    recorders.csrfReturn = NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403 },
    );
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(403);
    expect(res).toBe(recorders.csrfReturn);
    expect(recorders.rateLimitCalls).toHaveLength(0);
    expect(recorders.rpcCalls).toHaveLength(0);
  });

  it("returns 401 with no session and burns no limiter token", async () => {
    recorders.user = null;
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(recorders.rateLimitCalls).toHaveLength(0);
    expect(recorders.rpcCalls).toHaveLength(0);
  });

  it("returns 400 for a malformed id BEFORE the limiter (B15), and never revokes", async () => {
    const res = await POST(makeReq(), makeCtx("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(recorders.rateLimitCalls).toHaveLength(0);
    expect(recorders.rpcCalls).toHaveLength(0);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("returns 429 with Retry-After when the limiter denies", async () => {
    recorders.rateLimitResult = { success: false, retryAfter: 17 };
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    expect(recorders.rateLimitCalls).toEqual([
      `strategy-share-revoke:${VALID_USER.id}`,
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

describe("POST /api/strategies/[id]/share/revoke — the revoke (SHARE-03)", () => {
  it("calls revoke_strategy_share with the id ALONE and answers 200", async () => {
    recorders.rpcResult = { data: 1, error: null };
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revoked: true });
    expect(recorders.rpcCalls).toEqual([
      { fn: "revoke_strategy_share", args: { p_strategy_id: STRATEGY_ID } },
    ]);
    expect(Object.keys(recorders.rpcCalls[0].args)).toEqual(["p_strategy_id"]);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("never writes strategy_shares through a client chain — the RPC is the only writer", async () => {
    recorders.rpcResult = { data: 1, error: null };
    await POST(makeReq(), makeCtx());
    expect(recorders.tableCalls).toEqual([]);
    expect(ROUTE_SRC).not.toMatch(/\.from\(\s*["']strategy_shares["']/);
    expect(ROUTE_SRC).not.toMatch(/\.(insert|upsert|update|delete)\(/);
  });

  it("audits the kill on the success arm, with no token anywhere", async () => {
    recorders.rpcResult = { data: 1, error: null };
    await POST(makeReq(), makeCtx());
    expect(recorders.auditEvents).toEqual([
      {
        action: "strategy.share.revoke",
        entity_type: "strategy",
        entity_id: STRATEGY_ID,
        metadata: { revoked_count: 1 },
      },
    ]);
  });

  it("emits NO audit event when nothing was revoked", async () => {
    recorders.rpcResult = { data: 0, error: null };
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(404);
    expect(recorders.auditEvents).toHaveLength(0);
  });

  it("accepts a numeric-string count rather than 500-ing a real revoke", async () => {
    // int4 renders as a JSON number today. If a transport or serializer change
    // ever stringified it, the revoke still HAPPENED — answering 500 would be
    // a false alarm on a successful kill.
    recorders.rpcResult = { data: "1", error: null };
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(200);
    expect(recorders.auditEvents).toHaveLength(1);
  });
});

describe("POST /api/strategies/[id]/share/revoke — 404 as convergence (T-164-03)", () => {
  it("⭐ answers a double-revoke and a NON-OWNER with BYTE-IDENTICAL 404s", async () => {
    // The RPC's UPDATE is RLS-scoped and carries its own
    // `created_by = auth.uid()` predicate, so a non-owner's call affects zero
    // rows — the same answer as revoking an already-revoked share. If the two
    // ever diverge (a separate ownership probe, a different message, an extra
    // header) this route becomes an existence oracle for strategy ids.
    recorders.rpcResult = { data: 1, error: null };
    const first = await POST(makeReq(), makeCtx());
    expect(first.status).toBe(200);

    recorders.rpcResult = { data: 0, error: null };
    const secondRevoke = await snapshot(await POST(makeReq(), makeCtx()));
    const nonOwner = await snapshot(
      await POST(makeReq(FOREIGN_STRATEGY_ID), makeCtx(FOREIGN_STRATEGY_ID)),
    );

    expect(secondRevoke).toBe(nonOwner);
    expect(secondRevoke).toContain("404");
  });

  it("says nothing about existence in the 404 body", async () => {
    recorders.rpcResult = { data: 0, error: null };
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "share not found" });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("POST /api/strategies/[id]/share/revoke — failure arms", () => {
  it("redacts an RPC error and emits no audit event", async () => {
    recorders.rpcResult = {
      data: null,
      error: makePgError(
        'permission denied for table "strategy_shares"',
        "42501",
      ),
    };
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("strategy_shares");
    expect(body).not.toContain("42501");
    expect(recorders.auditEvents).toHaveLength(0);
    expect(recorders.sentryCaptures).toHaveLength(1);
  });

  it("answers 500 — NOT 404 — when the affected-row count is unreadable", async () => {
    // 404 is what the client reads as "the link is dead". Coercing an
    // unreadable answer to 0 would claim that without having established it;
    // the statement was SENT and the outcome is genuinely unknown.
    recorders.rpcResult = { data: null, error: null };
    const res = await POST(makeReq(), makeCtx());
    expect(res.status).toBe(500);
    expect(recorders.auditEvents).toHaveLength(0);
    expect(recorders.sentryCaptures).toHaveLength(1);
  });
});

describe("POST /api/strategies/[id]/share/revoke — source pins", () => {
  it("⛔ N2: no FOR UPDATE, no retry loop, no advisory lock", () => {
    // Founder ruling on measured evidence — the single-statement RPC guarded by
    // `revoked_at IS NULL` is what makes concurrent double-revoke converge, and
    // each of these "fixes" would break that convergence rather than help it.
    expect(ROUTE_CODE).not.toMatch(/FOR\s+UPDATE/i);
    expect(ROUTE_CODE).not.toMatch(/pg_advisory/i);
    expect(ROUTE_CODE).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{/);
    // "No retry loop" is asserted SEMANTICALLY, not lexically. A word-match on
    // `retry` fires on `Retry-After` and `rl.retryAfter`, which are the
    // limiter's legitimate vocabulary (MEASURED — that was this pin's first
    // failure). What a retry actually requires is a second call, so the pin is:
    // the RPC appears EXACTLY ONCE, and there is no loop to put a second one in.
    expect((ROUTE_CODE.match(/\.rpc\(/g) ?? []).length).toBe(1);
    // The stripper is not allowed to be the reason this passes: the code it
    // leaves behind must still contain the route's real body.
    expect(ROUTE_CODE).toContain("revoke_strategy_share");
  });

  it("keeps the RPC call in the shape the audit law can SEE — on ONE line", () => {
    // `findRpcMutations` (src/__tests__/audit-coverage.test.ts:264-269) tests
    // its regex against ONE LINE AT A TIME, so both a method-cast and a
    // Prettier wrap between `.rpc(` and the name hide this mutation from the
    // audit law. MEASURED on the mint sibling 2026-08-28: with either in
    // place, deleting the route's logAuditEvent left audit-coverage GREEN.
    const rpcLine = ROUTE_SRC.split("\n").find((l) =>
      /\.rpc\(\s*["']revoke_strategy_share["']/.test(l),
    );
    expect(rpcLine).toBeDefined();
  });

  it("never DELETEs — soft-revoke only, the audit trail keeps the row", () => {
    expect(ROUTE_SRC).not.toMatch(/\.delete\(/);
  });
});
