/**
 * B15 (audit-2026-05-07) — withAuthLimited canonical-order guarantees.
 *
 * The load-bearing assertion: an INVALID request body returns 400 and
 * `checkLimit` is NEVER called — i.e. a malformed/invalid request cannot
 * consume a rate-limit token. This is the whole point of the wrapper and the
 * class B15 closes; if a refactor ever reverts the order (limiter before
 * validation), the "does not consume a token on invalid body" test fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const STATE = vi.hoisted(() => ({
  user: { id: "00000000-0000-0000-0000-000000000001", email: "u@test.sec" } as
    | { id: string; email?: string }
    | null,
  checkLimitResult: { success: true, retryAfter: 0 } as {
    success: boolean;
    retryAfter: number;
    reason?: string;
  },
  checkLimitCalls: 0,
  approvalDenied: false,
}));

// withAuth's auth chain: getUser + approval gate + CSRF.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: STATE.user }, error: null }) },
  }),
}));
vi.mock("@/lib/csrf", () => ({ assertSameOrigin: () => null }));
vi.mock("@/lib/api/approval-gate", () => ({
  assertProfileApproved: async () =>
    STATE.approvalDenied
      ? NextResponse.json({ error: "Approval required" }, { status: 403 })
      : null,
}));

// Limiter surface. checkLimit increments a hoisted counter so the ordering
// guarantee (NOT called on invalid input) is observable.
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: { __mock: "limiter" },
  checkLimit: async () => {
    STATE.checkLimitCalls += 1;
    return STATE.checkLimitResult;
  },
  rateLimitDenyJson: (rl: { retryAfter: number; reason?: string }) =>
    NextResponse.json(
      {
        error:
          rl.reason === "ratelimit_misconfigured"
            ? "Rate limiter unavailable"
            : "Too many requests",
      },
      {
        status: rl.reason === "ratelimit_misconfigured" ? 503 : 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    ),
}));

import { withAuthLimited } from "./withAuthLimited";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const limiter = { __mock: "limiter" } as any;

const SCHEMA = z.object({ strategy_id: z.string().uuid() });
const VALID_ID = "11111111-1111-4111-8111-111111111111";

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  STATE.user = { id: "00000000-0000-0000-0000-000000000001", email: "u@test.sec" };
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.checkLimitCalls = 0;
  STATE.approvalDenied = false;
});

describe("withAuthLimited — canonical order (validate → limit)", () => {
  const handler = vi.fn(
    async (_req: NextRequest, _user: unknown, body: { strategy_id: string } | undefined) =>
      NextResponse.json({ ok: true, got: body?.strategy_id ?? null }),
  );

  beforeEach(() => handler.mockClear());

  it("INVALID body → 400 and checkLimit is NEVER called (no token burned)", async () => {
    const POST = withAuthLimited({ limiter, key: (u) => `t:${u.id}`, schema: SCHEMA }, handler);
    const res = await POST(req({ strategy_id: "not-a-uuid" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request body");
    expect(STATE.checkLimitCalls).toBe(0); // ← the B15 invariant
    expect(handler).not.toHaveBeenCalled();
  });

  it("malformed JSON → 400 and checkLimit NEVER called", async () => {
    const POST = withAuthLimited({ limiter, key: (u) => `t:${u.id}`, schema: SCHEMA }, handler);
    const res = await POST(req("{ not json"));
    expect(res.status).toBe(400);
    expect(STATE.checkLimitCalls).toBe(0);
  });

  it("valid body → checkLimit called once, then handler with typed body", async () => {
    const POST = withAuthLimited({ limiter, key: (u) => `t:${u.id}`, schema: SCHEMA }, handler);
    const res = await POST(req({ strategy_id: VALID_ID }));

    expect(res.status).toBe(200);
    expect(STATE.checkLimitCalls).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((await res.json()).got).toBe(VALID_ID);
  });

  it("valid body but over limit → 429 Retry-After, handler not called", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 15 };
    const POST = withAuthLimited({ limiter, key: (u) => `t:${u.id}`, schema: SCHEMA }, handler);
    const res = await POST(req({ strategy_id: VALID_ID }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("15");
    expect(handler).not.toHaveBeenCalled();
  });

  it("limiter misconfigured → 503 (fail-closed via rateLimitDenyJson)", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 60, reason: "ratelimit_misconfigured" };
    const POST = withAuthLimited({ limiter, key: (u) => `t:${u.id}`, schema: SCHEMA }, handler);
    const res = await POST(req({ strategy_id: VALID_ID }));
    expect(res.status).toBe(503);
  });

  it("maxBytes exceeded → 413 and checkLimit NEVER called", async () => {
    const POST = withAuthLimited(
      { limiter, key: (u) => `t:${u.id}`, schema: SCHEMA, maxBytes: 10 },
      handler,
    );
    const big = JSON.stringify({ strategy_id: VALID_ID, pad: "x".repeat(100) });
    const res = await POST(req(big));
    expect(res.status).toBe(413);
    expect(STATE.checkLimitCalls).toBe(0);
  });

  it("401 (no session) → checkLimit NEVER called", async () => {
    STATE.user = null;
    const POST = withAuthLimited({ limiter, key: (u) => `t:${u.id}`, schema: SCHEMA }, handler);
    const res = await POST(req({ strategy_id: VALID_ID }));
    expect(res.status).toBe(401);
    expect(STATE.checkLimitCalls).toBe(0);
  });

  it("schema-less route → handler receives undefined, limiter still enforced", async () => {
    const bodyless = vi.fn(async () => NextResponse.json({ ok: true }));
    const POST = withAuthLimited({ limiter, key: (u) => `t:${u.id}` }, bodyless);
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(STATE.checkLimitCalls).toBe(1);
  });

  it("approval gate stays ENFORCED when requireApproval is omitted (no undefined-override)", async () => {
    // Regression for the B15a review HIGH finding: forwarding
    // `{ requireApproval: undefined }` to withAuth would let the spread-merge
    // override withAuth's `true` default and silently disable the approval
    // gate. With the default fixed, an unapproved user must get 403 and the
    // handler + limiter must never run. This test FAILS if the default regresses.
    STATE.approvalDenied = true;
    const POST = withAuthLimited({ limiter, key: (u) => `t:${u.id}`, schema: SCHEMA }, handler);
    const res = await POST(req({ strategy_id: VALID_ID }));
    expect(res.status).toBe(403);
    expect(STATE.checkLimitCalls).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("empty body + required-field schema → 400, checkLimit NOT called", async () => {
    const POST = withAuthLimited({ limiter, key: (u) => `t:${u.id}`, schema: SCHEMA }, handler);
    const res = await POST(req("")); // empty body → {} → safeParse fails (strategy_id required)
    expect(res.status).toBe(400);
    expect(STATE.checkLimitCalls).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });
});
