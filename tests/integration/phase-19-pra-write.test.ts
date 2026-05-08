/**
 * Phase 19 / BACKBONE-04 step (a) / C-5 — PR-A write-path acceptance test.
 *
 * Locks the contract that `phase-19-shim-step-a` upserts a complete
 * `strategy_verifications` row with all 5 NOT NULL fields populated and a
 * resolvable strategy_id FK target. Without this, every teaser submission
 * post-repoint produces SQLSTATE 23502 / 23503 violations.
 *
 * The test mocks the Supabase admin client and asserts the EXACT shape of
 * the row passed to `.from('strategy_verifications').upsert(...)` — every
 * NOT NULL column from migration 093 + the public_token / expires_at first-
 * class columns from migration 103.
 */

// @vitest-environment node

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: null,
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
  getClientIp: () => "127.0.0.1",
}));

const verifyStrategyMock = vi.fn();
vi.mock("@/lib/analytics-client", () => ({
  verifyStrategy: verifyStrategyMock,
}));

vi.mock("@/lib/feature-flags", () => ({
  isUnifiedBackboneActive: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: vi.fn().mockResolvedValue(
    "11111111-2222-3333-4444-555555555555",
  ),
  CORRELATION_HEADER: "x-correlation-id",
}));

const ANCHOR_STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_VERIFICATION_ID = "22222222-2222-2222-2222-222222222222";

// Capture upsert + UPDATE arguments for assertion.
let strategyVerificationsUpsertArgs: unknown = null;
let verificationRequestsUpdateArgs: unknown = null;
let strategiesAnchorReturned: { id: string } | null = { id: ANCHOR_STRATEGY_ID };
// I-T-pra-write: optional upsert error injection. When set, the
// strategy_verifications.upsert mock returns this error instead of {error:null}.
let strategyVerificationsUpsertError: { message: string } | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "strategies") {
        return {
          select: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: strategiesAnchorReturned, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "strategy_verifications") {
        return {
          upsert: async (
            row: Record<string, unknown>,
            opts: Record<string, unknown>,
          ) => {
            strategyVerificationsUpsertArgs = { row, opts };
            return { error: strategyVerificationsUpsertError };
          },
        };
      }
      if (table === "verification_requests") {
        return {
          // Rate-limit count path.
          select: () => ({
            eq: () => ({
              gte: async () => ({ count: 0, error: null }),
            }),
          }),
          // Legacy UPDATE path.
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, _id: string) => {
              verificationRequestsUpdateArgs = patch;
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected admin table: ${table}`);
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  strategyVerificationsUpsertArgs = null;
  verificationRequestsUpdateArgs = null;
  strategiesAnchorReturned = { id: ANCHOR_STRATEGY_ID };
  strategyVerificationsUpsertError = null;
  verifyStrategyMock.mockResolvedValue({ verification_id: TEST_VERIFICATION_ID });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function postReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/verify-strategy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

describe("PR-A / phase-19-shim-step-a — strategy_verifications upsert (C-5)", () => {
  it("upserts a complete strategy_verifications row with all 5 NOT NULL fields populated", async () => {
    const { POST } = await import("@/app/api/verify-strategy/route");
    const res = await POST(
      postReq({
        email: "test@example.com",
        exchange: "okx",
        api_key: "k",
        api_secret: "s",
      }),
    );

    expect(res.status).toBe(200);
    expect(strategyVerificationsUpsertArgs).not.toBeNull();
    const { row, opts } = strategyVerificationsUpsertArgs as {
      row: Record<string, unknown>;
      opts: Record<string, unknown>;
    };

    // C-5: every NOT NULL column from migration 093 lines 79-93 populated.
    expect(row.id).toBe(TEST_VERIFICATION_ID);
    expect(row.strategy_id).toBe(ANCHOR_STRATEGY_ID);
    expect(typeof row.wizard_session_id).toBe("string");
    expect((row.wizard_session_id as string).length).toBeGreaterThan(0);
    expect(row.status).toBe("validated");
    expect(row.trust_tier).toBe("self_reported");
    expect(row.flow_type).toBe("teaser");
    expect(row.source).toBe("okx");
    // First-class columns from migration 103.
    expect(typeof row.public_token).toBe("string");
    expect((row.public_token as string).length).toBeGreaterThan(0);
    expect(typeof row.expires_at).toBe("string");

    // Conflict resolution onto the shared id (verification_id from analytics-service).
    expect(opts.onConflict).toBe("id");
  });

  it("source is derived from body.exchange (binance flows through)", async () => {
    const { POST } = await import("@/app/api/verify-strategy/route");
    await POST(
      postReq({
        email: "test@example.com",
        exchange: "binance",
        api_key: "k",
        api_secret: "s",
      }),
    );

    const { row } = strategyVerificationsUpsertArgs as {
      row: Record<string, unknown>;
    };
    expect(row.source).toBe("binance");
  });

  it("legacy verification_requests UPDATE still runs in stability-window dual-write", async () => {
    const { POST } = await import("@/app/api/verify-strategy/route");
    await POST(
      postReq({
        email: "test@example.com",
        exchange: "okx",
        api_key: "k",
        api_secret: "s",
      }),
    );

    expect(verificationRequestsUpdateArgs).not.toBeNull();
    const patch = verificationRequestsUpdateArgs as Record<string, unknown>;
    expect(typeof patch.public_token).toBe("string");
    expect(typeof patch.expires_at).toBe("string");
  });

  it("when no anchor strategies row exists, the upsert is skipped (graceful degrade)", async () => {
    strategiesAnchorReturned = null;

    const { POST } = await import("@/app/api/verify-strategy/route");
    const res = await POST(
      postReq({
        email: "test@example.com",
        exchange: "okx",
        api_key: "k",
        api_secret: "s",
      }),
    );

    // Request still succeeds because the legacy UPDATE preserves correctness.
    expect(res.status).toBe(200);
    expect(strategyVerificationsUpsertArgs).toBeNull();
    expect(verificationRequestsUpdateArgs).not.toBeNull();
  });

  /**
   * I-T-pra-write — strategy_verifications upsert FAILURE branch.
   *
   * If Supabase rejects the upsert (e.g. transient connection refused, schema
   * cache stale, RLS misconfig), the route MUST NOT 500. Instead the legacy
   * verification_requests UPDATE preserves runtime correctness during the
   * PR-A → PR-D stability window (see phase-19-shim-step-a comment in
   * src/app/api/verify-strategy/route.ts). This test pins that fallback.
   */
  it("I-T-pra-write: strategy_verifications upsert failure falls back to legacy UPDATE (no 500)", async () => {
    strategyVerificationsUpsertError = {
      message: "connection refused",
    };

    const { POST } = await import("@/app/api/verify-strategy/route");
    const res = await POST(
      postReq({
        email: "test@example.com",
        exchange: "okx",
        api_key: "k",
        api_secret: "s",
      }),
    );

    // Must NOT 500 — the legacy UPDATE saves the request.
    expect(res.status).toBe(200);
    // Upsert was attempted (proof the new write path ran first).
    expect(strategyVerificationsUpsertArgs).not.toBeNull();
    // Legacy UPDATE still ran (the fallback).
    expect(verificationRequestsUpdateArgs).not.toBeNull();
    const patch = verificationRequestsUpdateArgs as Record<string, unknown>;
    expect(typeof patch.public_token).toBe("string");
    expect(typeof patch.expires_at).toBe("string");
  });
});
