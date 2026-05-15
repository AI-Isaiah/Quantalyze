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
    // PR-X4a: was 'validated'. The public-status route at
    // src/app/api/verify-strategy/[id]/status/route.ts:107 only returns
    // `results` when status is 'complete' (legacy VR shape) or 'published'
    // (canonical SV terminal). 'validated' is an intermediate state with
    // no results surface, so teaser users polling the public URL never
    // saw their score. Terminal write now lands here in one shot.
    expect(row.status).toBe("published");
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

  /**
   * PR-X4a regression — the SV upsert MUST populate metrics_snapshot with
   * the `results` blob returned by the Python `/api/verify-strategy`
   * endpoint. Without this, the public-status route returns
   * `{status: 'published'}` with NO `results` field — teaser users see
   * "verified" but no score.
   *
   * The legacy handler is the kill-switch rollback target; even after
   * PR-X5 unifies the teaser path, an auto-rollback must surface metrics.
   */
  it("upserts metrics_snapshot from the Python results blob (PR-X4a)", async () => {
    const PYTHON_RESULTS = {
      twr: 0.42,
      sharpe: 1.7,
      return_24h: 0.01,
      return_mtd: 0.05,
      return_ytd: 0.31,
      equity_curve: [{ date: "2026-05-01", value: 1.0 }],
      trade_count: 142,
    };
    const MATCHED_STRATEGY_ID = "33333333-3333-3333-3333-333333333333";
    verifyStrategyMock.mockResolvedValueOnce({
      verification_id: TEST_VERIFICATION_ID,
      status: "complete",
      results: PYTHON_RESULTS,
      matched_strategy_id: MATCHED_STRATEGY_ID,
      twr: PYTHON_RESULTS.twr,
      sharpe: PYTHON_RESULTS.sharpe,
    });

    const { POST } = await import("@/app/api/verify-strategy/route");
    const res = await POST(
      postReq({
        email: "metrics-snapshot@example.com",
        exchange: "okx",
        api_key: "k",
        api_secret: "s",
      }),
    );

    expect(res.status).toBe(200);
    const { row } = strategyVerificationsUpsertArgs as {
      row: Record<string, unknown>;
    };
    const snapshot = row.metrics_snapshot as Record<string, unknown>;
    expect(snapshot).toBeDefined();
    expect(snapshot).not.toBeNull();
    // Every field from the Python results blob is present.
    expect(snapshot.twr).toBe(PYTHON_RESULTS.twr);
    expect(snapshot.sharpe).toBe(PYTHON_RESULTS.sharpe);
    expect(snapshot.return_24h).toBe(PYTHON_RESULTS.return_24h);
    expect(snapshot.return_mtd).toBe(PYTHON_RESULTS.return_mtd);
    expect(snapshot.return_ytd).toBe(PYTHON_RESULTS.return_ytd);
    expect(snapshot.equity_curve).toEqual(PYTHON_RESULTS.equity_curve);
    expect(snapshot.trade_count).toBe(PYTHON_RESULTS.trade_count);
    // matched_strategy_id is folded into metrics_snapshot because it's
    // not a first-class column on strategy_verifications. The public-
    // status route consumer reads it via `resolved.results.matched_strategy_id`.
    expect(snapshot.matched_strategy_id).toBe(MATCHED_STRATEGY_ID);
  });

  /**
   * PR-X4a edge case — when Python returns a verification_id without a
   * `results` blob (shouldn't happen post-PR-X2, but defensively), the
   * upsert sets metrics_snapshot to null instead of crashing.
   */
  it("upserts metrics_snapshot=null when Python returns no results blob (PR-X4a)", async () => {
    verifyStrategyMock.mockResolvedValueOnce({
      verification_id: TEST_VERIFICATION_ID,
      // no results, no matched_strategy_id
    });

    const { POST } = await import("@/app/api/verify-strategy/route");
    const res = await POST(
      postReq({
        email: "no-results@example.com",
        exchange: "okx",
        api_key: "k",
        api_secret: "s",
      }),
    );

    expect(res.status).toBe(200);
    const { row } = strategyVerificationsUpsertArgs as {
      row: Record<string, unknown>;
    };
    expect(row.metrics_snapshot).toBeNull();
    expect(row.status).toBe("published");
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
